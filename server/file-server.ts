/**
 * BiblioVault AI — Local File Server for Cloudflare Tunnel
 * Serves book files (PDFs, EPUBs, DOCs) from local disk
 * so the cloud server on Render can access them via tunnel.
 * 
 * Usage: npx tsx file-server.ts
 * Then run: cloudflared tunnel --url http://localhost:3002
 */

import express from 'express';
import { existsSync } from 'fs';
import { basename } from 'path';

const app = express();
const PORT = 3002;
const SECRET = process.env.TUNNEL_SECRET || 'bv-tunnel-2026';

// Simple auth middleware — prevents random access
app.use((req, res, next) => {
  const token = req.headers['x-tunnel-secret'] || req.query.secret;
  if (token !== SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve a file by its full path (URL-encoded)
app.get('/file', (req, res) => {
  const filePath = req.query.path as string;
  
  if (!filePath) {
    return res.status(400).json({ error: 'Missing "path" query parameter' });
  }

  // Decode the path
  const decodedPath = decodeURIComponent(filePath);
  
  if (!existsSync(decodedPath)) {
    return res.status(404).json({ error: 'File not found', path: decodedPath });
  }

  // Set appropriate content type
  const name = basename(decodedPath).toLowerCase();
  if (name.endsWith('.pdf')) {
    res.setHeader('Content-Type', 'application/pdf');
  } else if (name.endsWith('.epub')) {
    res.setHeader('Content-Type', 'application/epub+zip');
  } else if (name.endsWith('.docx')) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  } else if (name.endsWith('.doc')) {
    res.setHeader('Content-Type', 'application/msword');
  } else {
    res.setHeader('Content-Type', 'application/octet-stream');
  }

  res.setHeader('Content-Disposition', `inline; filename="${basename(decodedPath)}"`);
  res.sendFile(decodedPath, (err) => {
    if (err) {
      console.error(`Error serving ${decodedPath}:`, err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to serve file' });
      }
    }
  });
});

// Check if a file exists
app.get('/exists', (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath) {
    return res.status(400).json({ error: 'Missing "path" query parameter' });
  }
  const decodedPath = decodeURIComponent(filePath);
  res.json({ exists: existsSync(decodedPath), path: decodedPath });
});

app.listen(PORT, () => {
  console.log(`\n📁 BiblioVault File Server running on http://localhost:${PORT}`);
  console.log(`   Secret: ${SECRET}`);
  console.log(`   Ready for Cloudflare Tunnel\n`);
  console.log(`   Next step: In another terminal, run:`);
  console.log(`   cloudflared tunnel --url http://localhost:${PORT}\n`);
});
