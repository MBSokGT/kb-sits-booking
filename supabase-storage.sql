-- ═══════════════════════════════════════════════════════════════
-- Supabase Storage - Настройка хранилища для планов этажей
-- ═══════════════════════════════════════════════════════════════

-- Создайте bucket через Supabase Studio:
-- Storage → Create bucket → Name: "floor-plans" → Public: true

-- Или через SQL (если есть доступ):
-- INSERT INTO storage.buckets (id, name, public) VALUES ('floor-plans', 'floor-plans', true);

-- ═══════════════════════════════════════════════════════════════
-- RLS политики для Storage
-- ═══════════════════════════════════════════════════════════════

-- Все могут читать планы этажей
CREATE POLICY "Все могут читать планы этажей"
ON storage.objects FOR SELECT
USING (bucket_id = 'floor-plans');

-- Только админы могут загружать планы
CREATE POLICY "Админы могут загружать планы"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'floor-plans' 
  AND auth.role() = 'authenticated'
  AND EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
);

-- Только админы могут обновлять планы
CREATE POLICY "Админы могут обновлять планы"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'floor-plans'
  AND EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
);

-- Только админы могут удалять планы
CREATE POLICY "Админы могут удалять планы"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'floor-plans'
  AND EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
);

-- ═══════════════════════════════════════════════════════════════
-- Обновление таблицы floors для использования Storage
-- ═══════════════════════════════════════════════════════════════

-- Добавим поле storage_path вместо image_data
ALTER TABLE floors ADD COLUMN IF NOT EXISTS storage_path TEXT;

-- Комментарий:
-- image_data - для base64 (старый способ, большой размер)
-- storage_path - путь к файлу в Storage (новый способ, рекомендуется)
-- image_url - внешний URL (если файл хранится не в Supabase)

COMMENT ON COLUMN floors.image_data IS 'Base64 изображение (устаревший способ)';
COMMENT ON COLUMN floors.storage_path IS 'Путь к файлу в Supabase Storage (рекомендуется)';
COMMENT ON COLUMN floors.image_url IS 'Внешний URL изображения';
