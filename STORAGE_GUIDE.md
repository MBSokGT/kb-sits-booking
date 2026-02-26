# 📦 Настройка Supabase Storage для планов этажей

## Что такое Supabase Storage?

Supabase Storage - это S3-совместимое хранилище файлов с:
- ✅ Автоматическим CDN
- ✅ Оптимизацией изображений
- ✅ Row Level Security
- ✅ Публичными и приватными bucket'ами

## 🚀 Настройка Storage

### Шаг 1: Создайте bucket

#### Через Supabase Studio (рекомендуется):

1. Откройте http://localhost:3000 (или ваш Supabase Cloud)
2. **Storage** → **Create a new bucket**
3. Настройки:
   - **Name**: `floor-plans`
   - **Public bucket**: ✓ (включить)
   - **File size limit**: 50 MB
   - **Allowed MIME types**: `image/jpeg, image/png, image/jpg, application/pdf`
4. Нажмите **Create bucket**

#### Через SQL:

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'floor-plans',
  'floor-plans',
  true,
  52428800, -- 50 MB
  ARRAY['image/jpeg', 'image/png', 'image/jpg', 'application/pdf']
);
```

### Шаг 2: Примените RLS политики

Выполните SQL из файла `supabase-storage.sql`:

```bash
# Через psql
psql postgresql://postgres:postgres@localhost:54322/postgres -f supabase-storage.sql

# Или через Supabase Studio → SQL Editor
```

### Шаг 3: Обновите таблицу floors

SQL уже включён в `supabase-storage.sql`:

```sql
ALTER TABLE floors ADD COLUMN IF NOT EXISTS storage_path TEXT;
```

## 📝 Использование в коде

### Загрузка плана этажа

```javascript
// HTML
<input type="file" id="floor-plan-input" accept="image/*,.pdf">

// JavaScript
const fileInput = document.getElementById('floor-plan-input');
const file = fileInput.files[0];

// Загрузить файл
const { path, url } = await api.uploadFloorPlan(file, floorId);

console.log('Файл загружен:', path);
console.log('URL:', url);
```

### Получение URL плана

```javascript
// Получить URL из storage_path
const floor = await api.getFloors();
const url = api.getFloorPlanUrl(floor[0].storage_path);

console.log('URL плана:', url);

// Использовать в HTML
<img src="${url}" alt="План этажа">
```

### Удаление плана

```javascript
// Удалить файл из Storage
await api.deleteFloorPlan(storagePath);

// Обновить запись этажа
await api.updateFloor(floorId, {
  storage_path: null,
  image_url: null
});
```

## 🎨 Пример: Загрузка плана при создании этажа

```javascript
async function createFloorWithPlan() {
  try {
    // 1. Создать этаж
    const floor = await api.createFloor('Первый этаж', 1);
    
    // 2. Загрузить план
    const fileInput = document.getElementById('floor-plan-input');
    if (fileInput.files[0]) {
      const { url } = await api.uploadFloorPlan(fileInput.files[0], floor.id);
      console.log('План загружен:', url);
    }
    
    // 3. Обновить UI
    alert('Этаж создан!');
  } catch (error) {
    console.error('Ошибка:', error);
    alert('Ошибка: ' + error.message);
  }
}
```

## 📊 Структура хранения

```
floor-plans/
├── floor-uuid1-1234567890.jpg
├── floor-uuid2-1234567891.png
├── floor-uuid3-1234567892.pdf
└── ...
```

Формат имени файла: `floor-{floorId}-{timestamp}.{ext}`

## 🔒 Безопасность

### RLS политики:

- ✅ **Чтение**: Все пользователи
- ✅ **Загрузка**: Только администраторы
- ✅ **Обновление**: Только администраторы
- ✅ **Удаление**: Только администраторы

### Проверка прав:

```javascript
const currentUser = api.getCurrentUser();

if (currentUser.role === 'admin') {
  // Разрешить загрузку
  await api.uploadFloorPlan(file, floorId);
} else {
  alert('Только администраторы могут загружать планы');
}
```

## 🌐 Публичные URL

Storage bucket настроен как **публичный**, поэтому:

- ✅ Файлы доступны по прямой ссылке
- ✅ Не требуется авторизация для просмотра
- ✅ Можно использовать в `<img>` тегах
- ✅ CDN автоматически кеширует файлы

Пример URL:
```
http://127.0.0.1:54321/storage/v1/object/public/floor-plans/floor-uuid-123.jpg
```

## 📦 Миграция из base64

Если у вас уже есть планы в `image_data` (base64):

```javascript
async function migrateBase64ToStorage() {
  const floors = await api.getFloors();
  
  for (const floor of floors) {
    if (floor.image_data && !floor.storage_path) {
      // Конвертировать base64 в File
      const blob = await fetch(floor.image_data).then(r => r.blob());
      const file = new File([blob], `floor-${floor.id}.jpg`, { type: 'image/jpeg' });
      
      // Загрузить в Storage
      await api.uploadFloorPlan(file, floor.id);
      
      // Очистить image_data (опционально)
      await api.updateFloor(floor.id, { image_data: null });
      
      console.log(`Мигрирован этаж ${floor.name}`);
    }
  }
}
```

## 🧪 Тестирование

```javascript
// В консоли браузера (F12)

// 1. Проверить bucket
const { data: buckets } = await api.client.storage.listBuckets();
console.log('Buckets:', buckets);

// 2. Загрузить тестовый файл
const input = document.createElement('input');
input.type = 'file';
input.accept = 'image/*';
input.onchange = async (e) => {
  const file = e.target.files[0];
  const result = await api.uploadFloorPlan(file, 'test-floor-id');
  console.log('Загружено:', result);
};
input.click();

// 3. Получить список файлов
const { data: files } = await api.client.storage
  .from('floor-plans')
  .list();
console.log('Файлы:', files);
```

## 💡 Преимущества Storage vs base64

| Параметр | base64 (image_data) | Storage |
|----------|---------------------|---------|
| Размер в БД | Очень большой | Только путь |
| Скорость загрузки | Медленная | Быстрая (CDN) |
| Оптимизация | Нет | Автоматическая |
| Кеширование | Нет | Да |
| Лимит размера | ~1 MB | 50 MB+ |

## 🆘 Частые проблемы

### Ошибка "Bucket not found"
**Решение:** Создайте bucket через Studio

### Ошибка "Permission denied"
**Решение:** Проверьте RLS политики

### Файл не загружается
**Решение:** Проверьте MIME type и размер файла

## 📚 Документация

- Supabase Storage: https://supabase.com/docs/guides/storage
- Storage API: https://supabase.com/docs/reference/javascript/storage
