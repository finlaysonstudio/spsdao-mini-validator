export function log(msg: string): void {
  const ts = new Date().toISOString();
  console.log(`${ts} ${msg}`);
}

export function warn(msg: string): void {
  const ts = new Date().toISOString();
  console.error(`${ts} WARN ${msg}`);
}
