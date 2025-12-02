import 'dotenv/config';
import pdf2md from '@opendocsg/pdf2md';
import TurndownService from 'turndown';

// Azure OpenAI configuration
const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
const apiKey = process.env.AZURE_OPENAI_API_KEY;
const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-02-15-preview';

if (!endpoint || !apiKey || !deployment) {
  console.error('Error: Azure OpenAI environment variables are required');
  console.error('Required: AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT');
  console.error('Optional: AZURE_OPENAI_API_VERSION (default: 2024-02-15-preview)');
  console.error('Copy .env.example to .env and configure your Azure OpenAI settings');
  process.exit(1);
}

// Get URLs from command line arguments
const inputUrls = process.argv.slice(2);
if (inputUrls.length === 0) {
  console.error('Usage: node scrape2json.js <url> [url2] [url3] ...');
  console.error('Example: node scrape2json.js https://example.com/doc.pdf https://example.com/page.html');
  process.exit(1);
}

const itemSystemPrompt = `You are a document analyzer. Extract structured data from the provided document and return valid JSON only.`;

const itemUserPrompt = `Extract the following fields from this document:

- title: The document title
- date: The date relevant to the implementation (in ISO format YYYY-MM-DD if possible)
- summary: A concise summary of no more than 1 paragraph

Return ONLY valid JSON with these fields: date, title, summary

Document content:
`;

const metaSystemPrompt = `You are a document collection analyzer. Synthesize information from multiple document summaries and return valid JSON only.`;

const metaUserPrompt = `Given these document summaries, generate:

1. A concise title that describes the overall collection
2. A meta-summary (1 paragraph) synthesizing the key themes across all documents

Return ONLY valid JSON with these fields: title, summary

Document summaries:
`;

/**
 * Call Azure OpenAI chat completion API
 */
async function callAzureOpenAI(systemPrompt, userContent) {
  const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Azure OpenAI API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  
  if (!content) {
    throw new Error('No content in Azure OpenAI response');
  }

  return JSON.parse(content);
}

/**
 * Detect if a URL points to a PDF based on URL extension or content-type
 */
function isPdfUrl(url, contentType) {
  if (url.toLowerCase().endsWith('.pdf')) {
    return true;
  }
  if (contentType && contentType.includes('application/pdf')) {
    return true;
  }
  return false;
}

/**
 * Convert PDF buffer to Markdown
 */
async function pdfToMarkdown(buffer) {
  const markdown = await pdf2md(buffer);
  return markdown;
}

/**
 * Convert HTML to Markdown using Turndown
 */
function htmlToMarkdown(html) {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
  });
  return turndown.turndown(html);
}

/**
 * Fetch URL and convert to Markdown (handles both PDF and HTML)
 */
async function urlToMarkdown(url) {
  console.log(`Fetching ${url}...`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || '';
  
  if (isPdfUrl(url, contentType)) {
    console.log('  Converting PDF to Markdown...');
    const arrayBuffer = await response.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuffer);
    return await pdfToMarkdown(pdfBuffer);
  } else {
    console.log('  Converting HTML to Markdown...');
    const html = await response.text();
    return htmlToMarkdown(html);
  }
}

/**
 * Extract data from markdown using Azure OpenAI
 */
async function extractFromMarkdown(markdown, systemPrompt, userPromptPrefix) {
  // Truncate markdown if too long (leave room for prompts)
  const maxLength = 100000;
  const truncatedMarkdown = markdown.length > maxLength 
    ? markdown.substring(0, maxLength) + '\n\n[Content truncated...]'
    : markdown;
  
  return await callAzureOpenAI(systemPrompt, userPromptPrefix + truncatedMarkdown);
}

/**
 * Process a single URL: fetch, convert to markdown, extract data
 */
async function scrapeUrlToJson(url) {
  const markdown = await urlToMarkdown(url);
  console.log(`  Converted to ${markdown.length} characters of Markdown`);
  
  console.log('  Extracting data...');
  const result = await extractFromMarkdown(markdown, itemSystemPrompt, itemUserPrompt);
  
  return { ...result, url };
}

/**
 * Parse date string to Date object for sorting
 */
function parseDate(dateStr) {
  if (!dateStr) return new Date(0);
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

/**
 * Generate meta summary from all items
 */
async function generateMetaSummary(items) {
  const summariesMarkdown = items
    .map((item, i) => `## Document ${i + 1}: ${item.title || 'Untitled'}\n\nDate: ${item.date || 'Unknown'}\n\n${item.summary || 'No summary'}`)
    .join('\n\n---\n\n');
  
  console.log('\nGenerating meta summary...');
  console.log('Summaries being sent:\n' + summariesMarkdown.substring(0, 500) + '...\n');
  
  return await extractFromMarkdown(summariesMarkdown, metaSystemPrompt, metaUserPrompt);
}

/**
 * Main function: process multiple URLs and generate combined output
 */
async function scrapeMultipleUrls(urls) {
  // Process each URL sequentially to avoid rate limits
  const items = [];
  for (let i = 0; i < urls.length; i++) {
    console.log(`\n[${i + 1}/${urls.length}] Processing: ${urls[i]}`);
    try {
      const result = await scrapeUrlToJson(urls[i]);
      items.push(result);
    } catch (error) {
      console.error(`  Error processing ${urls[i]}: ${error.message}`);
      items.push({
        url: urls[i],
        title: null,
        date: null,
        summary: null,
        error: error.message
      });
    }
  }
  
  // Sort items by date
  const sortedItems = items.sort((a, b) => {
    return parseDate(a.date).getTime() - parseDate(b.date).getTime();
  });
  
  // Generate meta summary
  const validItems = sortedItems.filter(item => !item.error);
  const meta = validItems.length > 0 
    ? await generateMetaSummary(validItems)
    : { title: 'No valid documents', summary: 'All documents failed to process.' };
  
  return {
    title: meta.title,
    summary: meta.summary,
    items: sortedItems
  };
}

try {
  const result = await scrapeMultipleUrls(inputUrls);
  console.log('\n' + '='.repeat(60));
  console.log('Result:', JSON.stringify(result, null, 2));
} catch (error) {
  console.error('Error:', error);
}
