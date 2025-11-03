# SAGE Extension Privacy Policy

**Last Updated**: November 3rd, 2025

## Overview
SAGE (Safety Analysis Grading Engine) analyzes product ingredients to help users make informed shopping decisions about cosmetics, supplements, and food products. We are committed to protecting your privacy.

---

## Information We Collect

### 1. Personally Identifiable Information
- **Email address**: Used for account authentication via Supabase
- **Purpose**: Login and account recovery only
- **Storage**: Securely stored in Supabase (encrypted)

### 2. Website Content
- **Product URLs**: URLs of products you scan (e.g., Amazon, Sephora product pages)
- **Ingredient text**: Ingredient lists extracted from product pages
- **Purpose**: To analyze ingredients and provide safety grades (A-F scale)
- **Storage**: Stored in your private database (Supabase PostgreSQL)

### 3. Authentication Information
- **Supabase authentication tokens**: Stored locally in your browser
- **Purpose**: Keep you logged in between browser sessions
- **Storage**: Browser local storage (encrypted)

---

## How We Use Your Data

- **Product analysis**: Ingredient lists are sent to OpenAI's API to generate safety grades
- **Personal database**: All your scanned products are stored in your private Supabase database
- **User control**: You can delete any product or your entire account anytime via the dashboard

### What We DO NOT Do:
- Sell your data to third parties
- Share your data with advertisers
- Track your browsing history beyond the current product page
- Use cookies for advertising
- Collect health information, financial data, or location

---

## Data Storage & Security

- **Supabase**: User accounts and scan history (encrypted at rest, HTTPS in transit)
- **Local Browser Storage**: Authentication tokens and cached data
- **OpenAI**: Processes ingredient text for grading (not permanently stored by OpenAI)
- **Row Level Security**: Ensures users can only access their own data

---

## Third-Party Services

### Services We Use:
1. **Supabase** (Authentication & Database)
   - Purpose: User authentication and data storage
   - Privacy Policy: https://supabase.com/privacy

2. **OpenAI** (AI Analysis)
   - Purpose: Ingredient analysis and safety grading
   - Privacy Policy: https://openai.com/policies/privacy-policy
   - Note: OpenAI does not retain user data sent via API

3. **Tavily** (Web Research - Optional Fallback)
   - Purpose: Find ingredient data when not available on product page
   - Used only ~30% of the time as fallback
   - Privacy Policy: https://tavily.com/privacy

---

## Your Privacy Rights

- **Access**: View all your scanned products in the dashboard
- **Delete**: Remove individual products or delete your entire account anytime
- **Export**: Download your data (contact us for data export request)
- **Opt-out**: You can stop using the extension and delete your account at any time

---

## Data Retention

- **Active accounts**: Data is retained as long as your account is active
- **Deleted products**: Permanently removed from database immediately
- **Account deletion**: All associated data is permanently deleted within 30 days

---

## Children's Privacy

This service is not intended for users under 13 years of age. We do not knowingly collect personal information from children under 13.

---

## Chrome Extension Permissions

### Why We Request Each Permission:

- **activeTab**: Read current product page to extract ingredients when you click "Scan"
- **storage**: Store login session and cache scan results locally
- **tabs**: Detect product pages and open web dashboard
- **scripting**: Inject code to extract ingredients from product pages
- **sidePanel**: Display extension interface alongside your browsing
- **alarms**: Refresh login tokens and sync data periodically
- **notifications**: Alert you when scans complete
- **host permissions (<all_urls>)**: Access product pages across multiple sites (Amazon, Sephora, Ulta, etc.) when you explicitly scan them

---

## Changes to This Privacy Policy

We may update this privacy policy from time to time. We will notify users of any material changes by:
- Updating the "Last Updated" date above
- Posting a notice in the extension

---

## Data Compliance

This extension complies with:
- Chrome Web Store Developer Program Policies
- GDPR (General Data Protection Regulation)
- CCPA (California Consumer Privacy Act)

---

## Contact Us

If you have questions about this privacy policy or your data:

- **Email**: [dianabalteanu03@yahoo.com]
- **GitHub**: https://github.com/dianabalt/SAGE-Product-Analyzer/issues

---

## Consent

By using the SAGE extension, you consent to this privacy policy.
