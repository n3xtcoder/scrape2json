# scrape2json

Extract structured data from PDFs and web pages using AI.

## Installation

```bash
pnpm install
```

## Configuration

Copy `.env.example` to `.env` and add your ScrapeGraph API key:

```bash
cp .env.example .env
```

Then edit `.env`:

```
SCRAPEGRAPH_API_KEY=your-api-key-here
```

## Usage

```bash
node scrape2json.js <url>
```

### Examples

```bash
# Extract from PDF
node scrape2json.js https://dserver.bundestag.de/brd/2025/0204-25.pdf

# Extract from webpage
node scrape2json.js https://www.bundestag.de/dokumente/textarchiv/2025/kw42-de-rente-1115416
```

## Output

Returns JSON with:
- `date` — relevant implementation date
- `title` — document title
- `summary` — one paragraph summary in English
