# Logo in authentication email

The live templates are configured in Supabase Authentication → Email Templates.
Use the same header fragment in **Confirm sign up** and **Magic link or OTP**,
above their existing content. Leave the existing subject, text and
`{{ .Token }}` intact. Do not replace the code with `{{ .ConfirmationURL }}`.

```html
<p style="margin:0 0 20px">
  <img src="https://timeax.pl/timeax-email-logo.png" width="88" height="88"
       alt="Timeax" style="display:block;width:88px;height:88px;border:0">
</p>
```

The asset is a fixed public HTTPS URL with no recipient identifiers. The email
remains usable when its client blocks remote images. This is the in-message
logo, not an inbox avatar. After updating both templates, preview each one,
then request a normal user-owned OTP from timeax.pl. Do not send OTPs to
anyone else to test the logo.
