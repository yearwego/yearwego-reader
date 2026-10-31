declare module 'virtual:sql-wasm-base64' {
  const base64: string;
  export default base64;
}

declare module 'virtual:licenses' {
  const licenses: { title: string; version: string; license: string; text: string }[];
  export default licenses;
}
