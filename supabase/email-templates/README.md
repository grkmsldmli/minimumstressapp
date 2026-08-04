# Supabase auth email templates

These live in the Supabase dashboard, under **Authentication → Emails**. They are
kept here because a template that exists only in a dashboard is a piece of
product nobody can review, diff, or restore.

## Why they had to be replaced

Supabase's stock templates send a **link**, not a code. The app asks for six
digits — `verifyEmailCode` calls `verifyOtp` with `type: "email"` — so with the
default template the two never meet: the email hands you a link, the screen asks
for a number that is nowhere in it, and nothing reports an error. You are simply
asked for something you were never given.

`{{ .Token }}` is what puts the code in the email. Both templates need it,
because Supabase picks between them by whether the address has been seen before:

| Template | When |
|---|---|
| `confirm-signup.html` | First time an email signs in |
| `magic-link.html` | Every time after that |

They are identical on purpose. The brief's flow is one auth screen — a
practitioner's first visit and their tenth look the same — so the email should
not announce which one this is.

## Site URL

Also under **Authentication → URL Configuration**, and a separate trap. It was
left at `http://localhost:3000`, which meant a confirmation link pointed at a
machine only the developer has. These templates carry no link, so that no longer
breaks sign-in — but OAuth still redirects through it, so it has to be the
deployed URL, with localhost added to **Redirect URLs** for development.
