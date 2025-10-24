// server.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static('public'));
app.use('/', express.static('.'));

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

// Função auxiliar
function readJSON(file) {
  const p = path.join(dataDir, file);
  if (!fs.existsSync(p)) fs.writeFileSync(p, '[]');
  return JSON.parse(fs.readFileSync(p, 'utf8') || '[]');
}
function writeJSON(file, data) {
  fs.writeFileSync(path.join(dataDir, file), JSON.stringify(data, null, 2));
}

// Endpoints genéricos
['departamentos', 'professores', 'cursos', 'disciplinas', 'horarios', 'salas'].forEach(entity => {
  const file = `${entity}.json`;
  app.get(`/api/${entity}`, (req, res) => res.json(readJSON(file)));

  app.post(`/api/${entity}`, (req, res) => {
    writeJSON(file, req.body);
    res.json({ ok: true });
  });
});

app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
