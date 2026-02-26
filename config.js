// ═══════════════════════════════════════════════════════════════
// Конфигурация Supabase
// ═══════════════════════════════════════════════════════════════

const SUPABASE_CONFIG = {
  url: 'http://127.0.0.1:54321',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
};

// ═══════════════════════════════════════════════════════════════
// Как получить ключи:
// ═══════════════════════════════════════════════════════════════
// 1. Откройте Supabase Studio: http://localhost:3000
// 2. Перейдите в Settings → API
// 3. Скопируйте:
//    - Project URL → вставьте в url
//    - anon public key → вставьте в anonKey
// ═══════════════════════════════════════════════════════════════
