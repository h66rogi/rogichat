// Transitional adapters for transaction-level consumers awaiting R3 module conversion.
// There is ONE implementation in MessagesCoreService; HTTP uses MessagesModule's Nest providers.
// Remove this composition adapter when reactions/publications/media and their fixtures migrate.
import { MessagesCoreService } from './modules/messages/messages-core.service.js';
import { MessagesRepository } from './modules/messages/messages.repository.js';
import { AccessService } from './modules/access/access.service.js';
import { MembershipRepository } from './modules/access/membership.repository.js';
const legacyMessages = new MessagesCoreService(new MessagesRepository(), new AccessService(new MembershipRepository()));
export { sendInput } from './modules/messages/dto/send-message.dto.js';
export type { SendInput } from './modules/messages/dto/send-message.dto.js';
export type { MessageRow } from './modules/messages/message.types.js';
export const loadMessage = legacyMessages.load.bind(legacyMessages);
export const readable = legacyMessages.readable.bind(legacyMessages);
export const projectMessage = legacyMessages.project.bind(legacyMessages);
export const getMessage = legacyMessages.get.bind(legacyMessages);
export const sendMessage = legacyMessages.send.bind(legacyMessages);
export const deleteMessage = legacyMessages.remove.bind(legacyMessages);
export const recordMessageEvent = legacyMessages.recordEvent.bind(legacyMessages);
