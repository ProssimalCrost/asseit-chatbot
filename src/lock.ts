// Serializa o processamento por telefone (evita corrida entre duas mensagens seguidas do mesmo contato).
// Vale para uma única instância do backend, que é o cenário previsto (Render, porte pequeno).
const tails = new Map<string, Promise<unknown>>();

export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  tails.set(key, next);
  next
    .finally(() => {
      if (tails.get(key) === next) tails.delete(key);
    })
    .catch(() => undefined);
  return next;
}
