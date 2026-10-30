import { ConversationEngine } from "@/conversation/ConversationEngine";
import { NavigationController } from "@/navigation/NavigationController";
import { requestRoute } from "@/services/client";
import type { Location } from "@/types/domain";

type RuntimeCallbacks = Omit<ConstructorParameters<typeof ConversationEngine>[1], "getReferenceLocation">;

export function createNavigationRuntime(callbacks: RuntimeCallbacks) {
  let reference: Location | null = null;
  const navigation = new NavigationController(requestRoute);
  const conversation = new ConversationEngine(navigation, {
    ...callbacks,
    getReferenceLocation: () => reference,
  });

  return {
    navigation,
    conversation,
    setReferenceLocation(location: Location | null) { reference = location; },
  };
}