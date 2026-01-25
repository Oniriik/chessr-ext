# Changelog

All notable changes to Chessr will be documented in this file.

## [1.1.1] - 2026-01-25

### Added
- **Email confirmation flow**: After signup, users now see a "Verify your email" notification with the email address
- **Resend confirmation email**: Users can resend the confirmation email if needed (with loading state on button)
- **Password reset flow**: Complete password reset functionality
  - Reset password email template (`emails/reset-password.html`)
  - Reset password page on landing (`/reset-password`)
  - Redirects to `chessr.io/reset-password` with tokens
- **Email templates**: Branded email templates for Supabase
  - Confirmation email (`emails/confirm-email.html`)
  - Reset password email (`emails/reset-password.html`)
- **Translations**: Added French and English translations for all new auth-related strings

### Changed
- **Auth store**: Separated `initializing` state from `loading` state to prevent component unmounting during auth actions
- **Signup behavior**: Signup no longer auto-logs in the user; requires email confirmation first
- **Login error handling**: "Email not confirmed" errors now show a verify card with resend option instead of error message

### Fixed
- Fixed component unmounting during auth actions causing notification to not display

## [1.1.0] - 2026-01-24

### Added
- Initial release with ELO-based move suggestions
- Humanized moves system
- Opening book support
- Multi-language support (EN, FR)
- Cloud settings sync with Supabase
