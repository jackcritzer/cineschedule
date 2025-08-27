import express from 'express';

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

app.get('/health', (_req, res) => {
    res.json({ ok: true, db: false, note: "DB not wired yet."});
});

app.listen(PORT, () => {
    console.log(`API listening on http:\\localhost:${PORT}`);
})