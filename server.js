const express = require('express');
const fs = require('fs');
const path = require('path');


const app = express();


if (process.env.NODE_ENV !== 'production') {
app.use((req, res, next) => {
console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
next();
});
}


app.get('/', (req, res) => {
res.send('Hello world — serveur volontairement non optimisé mais fonctionnel');
});


app.get('/big', async (req, res, next) => {
const filePath = path.join(__dirname, 'maybe-big-file.txt');
try {
const data = await fs.promises.readFile(filePath, 'utf8');
res.send(data.replace(/\n/g, '<br/>'));
} catch (error) {
if (error.code === 'ENOENT') {
return res.status(404).send('Fichier introuvable');
}

next(error);
}
});

app.use((error, req, res, next) => {
console.error(error);
res.status(500).send('Erreur serveur');
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
console.log(`Serveur démarré sur le port ${PORT}`);
});