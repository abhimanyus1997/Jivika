// Minimal types for the parts of sql.js the SQL runner uses (the package ships none).
declare module 'sql.js' {
  type Value = number | string | Uint8Array | null
  interface QueryResult {
    columns: string[]
    values: Value[][]
  }
  interface Database {
    run(sql: string): Database
    exec(sql: string): QueryResult[]
    close(): void
  }
  interface SqlJs {
    Database: new () => Database
  }
  export default function initSqlJs(config?: { locateFile?: (file: string) => string }): Promise<SqlJs>
}
