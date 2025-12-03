import 'dotenv/config';
import pdf2md from '@opendocsg/pdf2md';
import TurndownService from 'turndown';

// Azure OpenAI configuration
const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
const apiKey = process.env.AZURE_OPENAI_API_KEY;
const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-02-15-preview';
const temperature = parseFloat(process.env.AZURE_OPENAI_TEMPERATURE) || 0.2;
const throttleMs = parseInt(process.env.AZURE_OPENAI_THROTTLE_MS) || 5000; // 5 seconds default
const maxMarkdownLength = parseInt(process.env.MAX_MARKDOWN_LENGTH) || 50000; // ~50k chars default

if (!endpoint || !apiKey || !deployment) {
  console.error('Error: Azure OpenAI environment variables are required');
  console.error('Required: AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT');
  console.error('Optional: AZURE_OPENAI_API_VERSION (default: 2024-02-15-preview)');
  console.error('Optional: AZURE_OPENAI_TEMPERATURE (default: 0.2)');
  console.error('Optional: AZURE_OPENAI_THROTTLE_MS (default: 5000)');
  console.error('Optional: MAX_MARKDOWN_LENGTH (default: 50000)');
  console.error('Copy .env.example to .env and configure your Azure OpenAI settings');
  process.exit(1);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Get URLs from command line arguments
const inputUrls = process.argv.slice(2);
if (inputUrls.length === 0) {
  console.error('Usage: node scrape2json.js <url> [url2] [url3] ...');
  console.error('Example: node scrape2json.js https://example.com/doc.pdf https://example.com/page.html');
  process.exit(1);
}

const itemSystemPrompt = `You extract structured data from documents. Be extremely concise. Return valid JSON only.`;

const itemUserPrompt = `Extract from this document:

- title: Document title
- date: Implementation date (YYYY-MM-DD)
- summary: 2-3 sentences maximum, key points only

Return JSON with: date, title, summary

Document:
`;

const metaSystemPrompt = `You synthesize document collections. Be extremely concise. Return valid JSON only.`;

const metaUserPrompt = `From these summaries, generate:

- title: Brief collection title
- summary: 2-3 sentences synthesizing key themes

Return JSON with: title, summary

Summaries:
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
      temperature
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

  // Throttle to avoid rate limits
  if (throttleMs > 0) {
    console.log(`  Throttling ${throttleMs}ms...`);
    await sleep(throttleMs);
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
  const truncatedMarkdown = markdown.length > maxMarkdownLength 
    ? markdown.substring(0, maxMarkdownLength) + '\n\n[Content truncated...]'
    : markdown;
  
  if (markdown.length > maxMarkdownLength) {
    console.log(`  Truncated from ${markdown.length} to ${maxMarkdownLength} chars`);
  }
  
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
