-- Adiciona a coluna meal_time para armazenar o horário real em que a refeição aconteceu, sem fuso horário (TIME)
ALTER TABLE meal_logs ADD COLUMN meal_time TIME;
