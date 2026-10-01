import { createGeneration, createGenerationErrorMessage } from "../generate/generations.ts";

export async function createModelFromDescription(description: string): Promise<{ generationId: string } | { error: string }> {
  try {
    const result = await createGeneration({ branch: "rudalle", prompt: description });
    return "error" in result
      ? { error: createGenerationErrorMessage(result.error) }
      : { generationId: result.generation.id };
  } catch {
    return { error: "Не удалось отправить. Проверьте связь и попробуйте снова." };
  }
}
