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

// Get URL from command line argument
const inputUrl = process.argv[2];
if (!inputUrl) {
  console.error('Usage: node scrape2json.js <url>');
  console.error('Example: node scrape2json.js https://example.com/document.pdf');
  console.error('         node scrape2json.js https://example.com/page.html');
  process.exit(1);
}

const prompt = `Extract the following fields:

- title
- date (relevant to the implementation)

Generate a summary of no more than 1 paragraph.

Return JSON with following fields:

- date
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
  console.log('Converting PDF to Markdown...');
  const markdown = await pdf2md(buffer);
  return markdown;
}

/**
 * Convert HTML to Markdown using Turndown
 */
function htmlToMarkdown(html) {
  console.log('Converting HTML to Markdown...');
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
    // Handle PDF
    const arrayBuffer = await response.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuffer);
    return await pdfToMarkdown(pdfBuffer);
  } else {
    // Handle HTML
    const html = await response.text();
    return htmlToMarkdown(html);
  }
}

/**
 * Main function: fetch URL, convert to markdown, extract data with smartScraper
 */
async function scrapeUrlToJson(url) {
  const markdown = await urlToMarkdown(url);
  console.log(`Converted to ${markdown.length} characters of Markdown`);
  
  // Pass markdown to smartScraper
  console.log('Extracting data with smartScraper...');
  const result = await smartScraper(
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
  
  return result;
}

try {
  const result = await scrapeUrlToJson(inputUrl);
  console.log('Result:', JSON.stringify(result, null, 2));
} catch (error) {
  console.error('Error:', error);
}
