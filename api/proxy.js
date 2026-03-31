// api/proxy.js  — create this file in your project
export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).send('Missing url');

  try {
    const response = await fetch(decodeURIComponent(url));
    const buffer   = await response.arrayBuffer();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/pdf');
    res.send(Buffer.from(buffer));
  } catch(e) {
    res.status(500).send('Fetch failed: ' + e.message);
  }
}
