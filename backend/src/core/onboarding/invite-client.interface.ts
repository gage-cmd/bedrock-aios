// The boundary between onboarding and Supabase Auth's invite machinery,
// mirroring shared/messaging's SmsClient: the service depends on this
// interface, and INVITE_PROVIDER picks the real GoTrue client or the stub
// (see onboarding.service.ts), so flow tests never send a real email the
// same way SMS tests never purchase a real number.

export interface InvitedUser {
  userId: string;
  email: string;
}

export interface InviteClient {
  inviteUserByEmail(email: string): Promise<InvitedUser>;
}
