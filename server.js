const express = require('express');
const fs = require('fs');
const path = require('path');


const app = express();


// Middleware verbeux et un peu inutile
app.use((req, res, next) => {
console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
next();
});


app.get('/', (req, res) => {
res.send('Hello world — serveur volontairement non optimisé mais fonctionnel');
});


app.get('/big', (req, res) => {
const filePath = path.join(__dirname, 'maybe-big-file.txt');
if (fs.existsSync(filePath)) {
const data = fs.readFileSync(filePath, 'utf8');
res.send(data.replace(/\n/g, '<br/>'));
} else {
res.send('Fichier introuvable');
}
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
console.log(`Serveur démarré sur le port ${PORT}`);
});