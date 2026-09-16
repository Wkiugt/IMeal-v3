CREATE TYPE "MealChoice" AS ENUM ('REGULAR', 'VEGETARIAN');

ALTER TABLE "registrations"
ADD COLUMN "meal_choice" "MealChoice" NOT NULL DEFAULT 'REGULAR';
