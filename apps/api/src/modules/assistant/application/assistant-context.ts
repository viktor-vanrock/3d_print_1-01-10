import { isAssistantEvidenceCitation, isAssistantLegacyCitation } from "@portal/contracts/http/assistant";
import type { AssistantCompletedTurns, AssistantRunContext } from "../domain/assistant-internal.ts";

export const ASSISTANT_CONTEXT_MAX_TURNS = 8;
export const ASSISTANT_CONTEXT_MAX_CHARACTERS = 12_000;
export const ASSISTANT_CONTEXT_MAX_REFERENCES = 20;
export const ASSISTANT_CONTEXT_UNAVAILABLE_MARKER = "[Предыдущий ответ недоступен из-за изменения доступа к источникам.]";

type ContextMessage = AssistantRunContext["context"][number];
export interface AssistantContextReference {
  readonly entityType: "printer" | "news" | "material" | "machine" | "user_printer";
  readonly entityId: string;
}
type ReferenceVisibility = (reference: AssistantContextReference) => Promise<boolean>;
type PreparedAssistant =
  | { readonly kind: "omit" }
  | { readonly kind: "fixed"; readonly content: string }
  | { readonly kind: "referenced"; readonly content: string; readonly references: readonly AssistantContextReference[] };
interface PreparedTurn {
  readonly userContent: string;
  readonly assistant: PreparedAssistant;
}

function normalizeContent(value: string): string {
  return value.normalize("NFC").replace(/\r\n?/gu, "\n").trim();
}

function characterCount(value: string): number {
  return Array.from(value).length;
}

function referencedEntities(result: Readonly<Record<string, unknown>>): readonly AssistantContextReference[] | "omit" | "unavailable" {
  if (!Array.isArray(result.citations) || result.citations.length === 0) return "omit";
  if (result.citations.every(isAssistantLegacyCitation)) return "omit";
  const references: AssistantContextReference[] = [];
  for (const citation of result.citations) {
    if (!isAssistantEvidenceCitation(citation)) return "unavailable";
    if (citation.entity_type === "printer") references.push({ entityType: "printer", entityId: citation.entity_id });
    else if (citation.entity_type === "comparison" && citation.facts.kind === "comparison") {
      references.push(...citation.facts.printer_ids.map((entityId) => ({ entityType: "printer" as const, entityId })));
    } else if (citation.entity_type === "news") references.push({ entityType: "news", entityId: citation.entity_id });
    else if (citation.entity_type === "material" && citation.facts.kind === "material") {
      references.push({ entityType: "material", entityId: citation.entity_id });
      if (citation.facts.machine_id) references.push({ entityType: "machine", entityId: citation.facts.machine_id });
      if (citation.facts.catalog_printer_id) references.push({ entityType: "printer", entityId: citation.facts.catalog_printer_id });
      if (citation.facts.user_printer_id) references.push({ entityType: "user_printer", entityId: citation.facts.user_printer_id });
    } else if (citation.entity_type === "machine") references.push({ entityType: "machine", entityId: citation.entity_id });
    else if (citation.entity_type === "user_printer" && citation.facts.kind === "user_printer") {
      references.push({ entityType: "user_printer", entityId: citation.entity_id });
      if (citation.facts.machine_id) references.push({ entityType: "machine", entityId: citation.facts.machine_id });
      if (citation.facts.catalog_printer_id) references.push({ entityType: "printer", entityId: citation.facts.catalog_printer_id });
    }
    else return "unavailable";
  }
  return references.length === 0 ? "unavailable" : references;
}

function prepareAssistantContent(resultType: "answer" | "clarification" | "generation_offer", result: Readonly<Record<string, unknown>>): PreparedAssistant {
  if (resultType === "clarification" && result.kind === "clarification" && typeof result.question === "string") {
    const content = normalizeContent(result.question);
    return content ? { kind: "fixed", content } : { kind: "omit" };
  }
  if (resultType !== "answer" || result.kind !== "answer" || typeof result.text !== "string") return { kind: "omit" };
  const content = normalizeContent(result.text);
  if (!content) return { kind: "omit" };
  const references = referencedEntities(result);
  if (references === "omit") return { kind: "omit" };
  if (references === "unavailable") return { kind: "fixed", content: ASSISTANT_CONTEXT_UNAVAILABLE_MARKER };
  return { kind: "referenced", content, references };
}

export async function buildAssistantContext(
  completed: AssistantCompletedTurns,
  currentMessage: string,
  isVisible: ReferenceVisibility,
): Promise<{ readonly currentMessage: string; readonly messages: readonly ContextMessage[]; readonly truncated: boolean; readonly omittedTurns: number }> {
  const normalizedCurrentMessage = normalizeContent(currentMessage);
  const currentCharacters = characterCount(normalizedCurrentMessage);
  let remainingCharacters = Math.max(0, ASSISTANT_CONTEXT_MAX_CHARACTERS - currentCharacters);
  const retained: PreparedTurn[] = [];
  let omittedForCharacters = 0;

  const boundedTurns = completed.turns.slice(0, ASSISTANT_CONTEXT_MAX_TURNS);
  for (const [index, turn] of boundedTurns.entries()) {
    const userContent = normalizeContent(turn.user_content);
    if (!userContent) continue;
    const assistant = prepareAssistantContent(turn.result_type, turn.result);
    const turnCharacters = characterCount(userContent) + (assistant.kind === "omit" ? 0 : characterCount(assistant.content));
    if (turnCharacters > remainingCharacters) {
      omittedForCharacters += boundedTurns.length - index;
      break;
    }
    retained.push({ userContent, assistant });
    remainingCharacters -= turnCharacters;
  }

  const validationReferences: AssistantContextReference[] = [];
  const validationSet = new Set<string>();
  const referencesByTurn = retained.map((turn) => {
    if (turn.assistant.kind !== "referenced") return null;
    const seenInAnswer = new Set<string>();
    const uniqueForAnswer = turn.assistant.references.filter((reference) => {
      const key = `${reference.entityType}:${reference.entityId}`;
      if (seenInAnswer.has(key)) return false;
      seenInAnswer.add(key);
      return true;
    });
    const newReferences = uniqueForAnswer.filter((reference) => !validationSet.has(`${reference.entityType}:${reference.entityId}`));
    if (validationSet.size + newReferences.length > ASSISTANT_CONTEXT_MAX_REFERENCES) return "overflow" as const;
    for (const reference of newReferences) {
      validationSet.add(`${reference.entityType}:${reference.entityId}`);
      validationReferences.push(reference);
    }
    return uniqueForAnswer;
  });
  const visibility = new Map<string, boolean>();
  const visibilityResults = await Promise.all(validationReferences.map(isVisible));
  validationReferences.forEach((reference, index) => visibility.set(`${reference.entityType}:${reference.entityId}`, visibilityResults[index] ?? false));

  const messages = retained
    .map((turn, index): ContextMessage[] => {
      let assistantContent: string | null = null;
      if (turn.assistant.kind === "fixed") assistantContent = turn.assistant.content;
      else if (turn.assistant.kind === "referenced") {
        const ids = referencesByTurn[index];
        assistantContent =
          ids !== undefined &&
          ids !== null &&
          ids !== "overflow" &&
          ids.every((reference) => visibility.get(`${reference.entityType}:${reference.entityId}`) === true)
            ? turn.assistant.content
            : ASSISTANT_CONTEXT_UNAVAILABLE_MARKER;
      }
      return [{ role: "user", content: turn.userContent }, ...(assistantContent === null ? [] : [{ role: "assistant" as const, content: assistantContent }])];
    })
    .reverse()
    .flat();
  const omittedBeyondRead = Math.max(0, completed.total - boundedTurns.length);
  const omittedTurns = omittedBeyondRead + omittedForCharacters;
  return { currentMessage: normalizedCurrentMessage, messages, truncated: omittedTurns > 0, omittedTurns };
}
