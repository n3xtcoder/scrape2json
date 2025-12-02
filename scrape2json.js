import 'dotenv/config';
import { smartScraper } from 'scrapegraph-js';
import pdf2md from '@opendocsg/pdf2md';
import TurndownService from 'turndown';

const apiKey = process.env.SCRAPEGRAPH_API_KEY;
if (!apiKey) {
  console.error('Error: SCRAPEGRAPH_API_KEY environment variable is required');
  console.error('Copy .env.example to .env and add your API key');
  process.exit(1);
}

// Get URLs from command line arguments
const inputUrls = process.argv.slice(2);
if (inputUrls.length === 0) {
  console.error('Usage: node scrape2json.js <url> [url2] [url3] ...');
  console.error('Example: node scrape2json.js https://example.com/doc.pdf https://example.com/page.html');
  process.exit(1);
}

const itemPrompt = `Extract the following fields:

- title
- date (relevant to the implementation)

Generate a summary of no more than 1 paragraph.

Return JSON with following fields:

- date
- title
- summary`;

const metaPrompt = `Given these document summaries, generate:

1. A concise title that describes the overall collection
2. A meta-summary (1 paragraph) synthesizing the key themes across all documents

Return JSON with following fields:

- title
- summary`;

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
 * Extract data from markdown using smartScraper
 */
async function extractWithSmartScraper(markdown, prompt) {
  return await smartScraper(
    apiKey,
    null,           // url (null since we're using websiteMarkdown)
    prompt,
    null,           // schema
    null,           // numberOfScrolls
    null,           // totalPages
    null,           // cookies
    {},             // options
    false,          // plain_text
    false,          // renderHeavyJs
    false,          // stealth
    null,           // websiteHtml
    markdown        // websiteMarkdown
  );
}

/**
 * Process a single URL: fetch, convert to markdown, extract data
 */
async function scrapeUrlToJson(url) {
  const markdown = await urlToMarkdown(url);
  console.log(`  Converted to ${markdown.length} characters of Markdown`);
  
  console.log('  Extracting data...');
  const result = await extractWithSmartScraper(markdown, itemPrompt);
  
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
 * Extract the actual result data from API response
 */
function unwrapResult(apiResponse) {
  // smartScraper returns { result: { ... }, request_id: ... }
  return apiResponse?.result || apiResponse;
}

/**
 * Generate meta summary from all items
 */
async function generateMetaSummary(items) {
  const summariesMarkdown = items
    .map((item, i) => {
      const data = unwrapResult(item);
      return `## Document ${i + 1}: ${data.title || 'Untitled'}\n\nDate: ${data.date || 'Unknown'}\n\n${data.summary || 'No summary'}`;
    })
    .join('\n\n---\n\n');
  
  console.log('\nGenerating meta summary...');
  console.log('Summaries being sent:\n' + summariesMarkdown.substring(0, 500) + '...\n');
  return await extractWithSmartScraper(summariesMarkdown, metaPrompt);
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
  
  // Sort items by date (unwrap result to access date field)
  const sortedItems = items.sort((a, b) => {
    const dateA = unwrapResult(a).date;
    const dateB = unwrapResult(b).date;
    return parseDate(dateA).getTime() - parseDate(dateB).getTime();
  });
  
  // Generate meta summary
  const validItems = sortedItems.filter(item => !item.error);
  const meta = validItems.length > 0 
    ? await generateMetaSummary(validItems)
    : { title: 'No valid documents', summary: 'All documents failed to process.' };
  
  // Normalize items to flatten the result structure
  const normalizedItems = sortedItems.map(item => {
    if (item.error) return item;
    const data = unwrapResult(item);
    return {
      url: item.url,
      title: data.title,
      date: data.date,
      summary: data.summary
    };
  });

  const metaData = unwrapResult(meta);
  return {
    title: metaData.title,
    summary: metaData.summary,
    items: normalizedItems
  };
}

try {
  const result = await scrapeMultipleUrls(inputUrls);
  console.log('\n' + '='.repeat(60));
  console.log('Result:', JSON.stringify(result, null, 2));
} catch (error) {
  console.error('Error:', error);
}
