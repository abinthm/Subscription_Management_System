const clients = new Set();

export function subscribe(res) {
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

export function publish(topic, payload = {}) {
  const data = `event: change\ndata: ${JSON.stringify({ topic, ...payload })}\n\n`;
  for (const res of clients) res.write(data);
}

setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
}, 25_000).unref();
