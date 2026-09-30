/** minúsculas y sin acentos, para buscar "Garcia" y encontrar "García". */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}
