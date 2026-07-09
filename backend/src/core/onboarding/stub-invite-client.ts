import { randomUUID } from 'crypto';
import { InviteClient, InvitedUser } from './invite-client.interface';

// Test/dev stand-in for GoTrueInviteClient: fabricates an auth user id
// without touching Supabase Auth or sending email, exactly as StubSmsClient
// fabricates phone numbers without touching Twilio. The users row onboarding
// writes is real either way -- only the auth-side effect is stubbed.
export class StubInviteClient implements InviteClient {
  readonly invited: InvitedUser[] = [];

  inviteUserByEmail(email: string): Promise<InvitedUser> {
    const user = { userId: randomUUID(), email };
    this.invited.push(user);
    return Promise.resolve(user);
  }
}
