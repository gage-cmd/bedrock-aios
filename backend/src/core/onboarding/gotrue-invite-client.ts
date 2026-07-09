import { InviteClient, InvitedUser } from './invite-client.interface';

// Sends a real invite through Supabase Auth's admin invite endpoint. GoTrue
// creates the auth user (unconfirmed) and emails them a magic invite link;
// the response carries the new auth user id, which onboarding then mirrors
// into public.users so the custom access token hook stamps tenant_id and
// app_role into their JWT at first login (see docs/auth-access-token-hook.md).
//
// Uses the service-role key over plain fetch rather than pulling in
// @supabase/supabase-js -- this is the backend's only Auth-admin call, and
// the endpoint is a single stable POST.
export class GoTrueInviteClient implements InviteClient {
  async inviteUserByEmail(email: string): Promise<InvitedUser> {
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) {
      // Fail closed, same posture as TwilioSignatureGuard without its token:
      // no key means no way to invite, not a silent stub fallback.
      throw new Error(
        'SUPABASE_SERVICE_ROLE_KEY is not set; cannot send invites',
      );
    }

    // redirect_to sends the invite link straight to the page that lets the
    // new owner set their password (apps/dashboard/app/set-password) --
    // without it GoTrue falls back to the project's default Site URL, which
    // has nowhere to complete the invite.
    const inviteUrl = new URL('/auth/v1/invite', process.env.SUPABASE_URL);
    inviteUrl.searchParams.set(
      'redirect_to',
      new URL('/set-password', process.env.DASHBOARD_URL).toString(),
    );

    const res = await fetch(inviteUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ email }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        msg?: string;
        message?: string;
      } | null;
      throw new Error(
        `Invite failed (${res.status}): ${body?.msg ?? body?.message ?? 'unknown error'}`,
      );
    }

    const user = (await res.json()) as { id: string; email: string };
    return { userId: user.id, email: user.email };
  }
}
