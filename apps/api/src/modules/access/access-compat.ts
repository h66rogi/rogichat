// Only legacy transaction functions use this adapter during R3 migration.
// New feature modules import AccessModule and inject its narrow service.
import { AccessService } from './access.service.js';
import { MembershipRepository } from './membership.repository.js';
const legacyAccess = new AccessService(new MembershipRepository());
export const activeMember = legacyAccess.requireActiveMember.bind(legacyAccess);
