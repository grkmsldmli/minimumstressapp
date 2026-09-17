import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Delete Your Account | Minimum Stress",
  description: "How to permanently delete your Minimum Stress account and associated personal data.",
  alternates: { canonical: "/delete-account" },
};

export default function DeleteAccountPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#F7FAFC",
        color: "#16304E",
        padding: "48px 20px",
      }}
    >
      <article
        style={{
          width: "100%",
          maxWidth: 760,
          margin: "0 auto",
          background: "#FFFFFF",
          border: "1px solid #DCE7F2",
          borderRadius: 24,
          padding: "36px 30px",
          boxShadow: "0 12px 36px rgba(22, 48, 78, 0.08)",
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#5D7894",
          }}
        >
          Minimum Stress
        </p>

        <h1 style={{ margin: "10px 0 12px", fontSize: 34, lineHeight: 1.15 }}>
          Delete your account
        </h1>

        <p style={{ margin: 0, fontSize: 17, lineHeight: 1.7, color: "#49627A" }}>
          You can permanently delete your Minimum Stress account directly in the app. If you no
          longer have access to the app, you can also request deletion by email.
        </p>

        <section style={{ marginTop: 32 }}>
          <h2 style={{ margin: "0 0 12px", fontSize: 21 }}>Delete in the app</h2>
          <ol style={{ margin: 0, paddingLeft: 22, lineHeight: 1.8, color: "#334E68" }}>
            <li>Open Minimum Stress and sign in.</li>
            <li>Go to your Profile.</li>
            <li>Select Delete my account.</li>
            <li>Follow the confirmation steps shown in the app.</li>
          </ol>
          <p style={{ margin: "12px 0 0", lineHeight: 1.7, color: "#5D7894" }}>
            If you have an upcoming session, cancel it first before deleting your account.
          </p>
        </section>

        <section style={{ marginTop: 30 }}>
          <h2 style={{ margin: "0 0 12px", fontSize: 21 }}>Request deletion by email</h2>
          <p style={{ margin: 0, lineHeight: 1.7, color: "#334E68" }}>
            If you cannot access the app, email us from the email address associated with your
            Minimum Stress account and ask us to delete your account.
          </p>
          <p style={{ margin: "16px 0 0" }}>
            <a
              href="mailto:info@minimumstress.com?subject=Minimum%20Stress%20Account%20Deletion%20Request"
              style={{
                display: "inline-block",
                background: "#16304E",
                color: "#FFFFFF",
                textDecoration: "none",
                fontWeight: 700,
                padding: "12px 18px",
                borderRadius: 999,
              }}
            >
              Email info@minimumstress.com
            </a>
          </p>
        </section>

        <section style={{ marginTop: 32, paddingTop: 28, borderTop: "1px solid #E5EDF5" }}>
          <h2 style={{ margin: "0 0 12px", fontSize: 21 }}>What is deleted</h2>
          <p style={{ margin: 0, lineHeight: 1.7, color: "#334E68" }}>
            Account deletion removes your sign-in and personal profile information, including your
            name, profile photo, phone number, emergency contact information, uploaded verification
            documents, and listing media associated with your account. Your listings are removed or
            delisted as applicable.
          </p>
        </section>

        <section style={{ marginTop: 26 }}>
          <h2 style={{ margin: "0 0 12px", fontSize: 21 }}>What may be kept</h2>
          <p style={{ margin: 0, lineHeight: 1.7, color: "#334E68" }}>
            Completed bookings may be retained as financial records because they also form part of
            the other party&apos;s transaction and income history. Review ratings may remain detached
            from your identity, while written review comments are removed. Records that must be kept
            for tax, accounting, fraud prevention, dispute resolution, or other legal obligations are
            retained only for as long as applicable law requires. First-party app-open and public-site
            page-view analytics are deleted after 90 days.
          </p>
        </section>

        <section style={{ marginTop: 26 }}>
          <h2 style={{ margin: "0 0 12px", fontSize: 21 }}>Questions</h2>
          <p style={{ margin: 0, lineHeight: 1.7, color: "#334E68" }}>
            Contact <a href="mailto:info@minimumstress.com">info@minimumstress.com</a> for help with
            an account deletion request.
          </p>
        </section>
      </article>
    </main>
  );
}
