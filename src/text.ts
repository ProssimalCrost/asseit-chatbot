/** MAIÚSCULAS, sem acentos, sem espaços nas pontas e com espaços internos únicos. */
export function normalize(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}
