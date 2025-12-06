# scrape2json

Extract structured data from PDFs and web pages using Azure OpenAI.

## Installation

```bash
pnpm install
```

## Configuration

Copy `.env.example` to `.env` and configure your Azure OpenAI settings:

```bash
cp .env.example .env
```

Required environment variables:

```
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_API_KEY=your-api-key
AZURE_OPENAI_DEPLOYMENT=your-deployment-name
AZURE_OPENAI_API_VERSION=2024-02-15-preview  # optional
```

## Usage

```bash
node scrape2json.js <url> [url2] [url3] ...
```

Accepts multiple URLs (mix of PDFs and web pages). Processes each, then generates a meta summary.

### Examples

```bash
# Single document
node scrape2json.js https://dserver.bundestag.de/brd/2025/0204-25.pdf

# Multiple documents
node scrape2json.js \
  https://dserver.bundestag.de/brd/2025/0204-25.pdf \
  https://www.bundestag.de/dokumente/textarchiv/2025/kw42-de-rente-1115416
```

## Output

Returns JSON with:
- `title` — generated title for the collection
- `summary` — meta-summary synthesizing all documents
- `items` — array of documents sorted by date, each with:
  - `date` — relevant implementation date
  - `title` — document title
  - `summary` — one paragraph summary
  - `url` — source URL
