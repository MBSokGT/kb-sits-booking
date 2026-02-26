// Инициализация приложения с Supabase
console.log('🚀 Инициализация КБ Ситс...');

// Проверяем доступность Supabase
if (typeof supabase === 'undefined') {
  console.warn('⚠️ Supabase SDK не загружен');
}

// Инициализируем dataAdapter при загрузке страницы
document.addEventListener('DOMContentLoaded', async () => {
  try {
    console.log('📡 Подключение к Supabase...');
    await dataAdapter.init();
    console.log('✅ DataAdapter инициализирован');
  } catch (error) {
    console.error('❌ Ошибка инициализации:', error);
  }
});
