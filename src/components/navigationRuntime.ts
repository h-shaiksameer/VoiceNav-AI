import { ConversationEngine } from "@/conversation/ConversationEngine";
import { NavigationController } from "@/navigation/NavigationController";
import { requestRoute } from "@/services/client";
import type { Location } from "@/types/domain";
import { IntentProcessor } from "@/ai/IntentProcessor";
import { BasetenIntentProvider } from "@/ai/providers/BasetenIntentProvider";

type RuntimeCallbacks = Omit<ConstructorParameters<typeof ConversationEngine>[1], "getReferenceLocation">;

export function createNavigationRuntime(callbacks: RuntimeCallbacks) {
  let reference: Location | null = null;
  const navigation = new NavigationController(requestRoute);
  const aiProvider = new BasetenIntentProvider();
  const conversation = new ConversationEngine(navigation, {
    ...callbacks,
    getReferenceLocation: () => reference,
  }, undefined, new IntentProcessor(aiProvider));

  return {
    navigation,
    conversation,
    aiProvider,
    setReferenceLocation(location: Location | null) { reference = location; },
  };
}