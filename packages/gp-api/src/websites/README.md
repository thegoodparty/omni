# Website and Domain Functionality Documentation

## Database Models

### Website

The main website entity that stores campaign website data including content, status, and vanity path for public access.

### Domain

For using a custom domain for a website. `operationId` holds the Vercel registrar order id (falling back to a synthetic `vercel-<domain>-<timestamp>` when Vercel returns none). Stores the registration price and a Stripe paymentId for connecting a customer payment to the entity.

The two vendors split the work, which is easy to get wrong when reading this module:

| Concern                                                              | Vendor               |
| -------------------------------------------------------------------- | -------------------- |
| Availability checks, name suggestions                                | **AWS Route 53**     |
| Pricing, registration, renewal, project hosting, transfer auth codes | **Vercel registrar** |

So a domain is _registered_ through Vercel even though it was _searched_ through Route 53. Anything describing registration, renewal, or DNS as a Route 53 operation is out of date.

A row in this table only ever comes from a campaign purchase, which is what distinguishes candidate domains from GoodParty's own infrastructure domains living in the same Vercel team.

### WebsiteContact

Stores basic contact form submissions from website visitors including name, email, phone, message, and SMS consent. Just used for capturing form submissions and displaying them until a larger CRM type solution can be implemented.

### WebsiteView

Used for very basic tracking of visitor views. Frontend generates a UUID in localStorage to identify individual visitors, and will send a tracking call once per session.

### Relationships

- **Website** ↔ **Campaign**: One-to-one relationship (each campaign has one website)
- **Website** ↔ **Domain**: One-to-one relationship (each website can have one custom domain)
- **Website** ↔ **WebsiteContact**: One-to-many relationship (website has many contact submissions)
- **Website** ↔ **WebsiteView**: One-to-many relationship (website has many view records)

## API Endpoints

### Website Management (WebsitesController)

#### Creating a Website

**POST** `/websites`

- Creates a new website for the current user's campaign
- Automatically generates default content based on campaign positions and user data
- Defaults the `vanityPath` to the campaign's slug
- Returns the created website with basic content structure

#### Updating Website Content

**PUT** `/websites/mine`

- Updates website content and configuration
- Accepts multipart form data for file uploads (logo and hero images)
- Merges content updates with existing content using deep merge
- **Payload Structure:**

  ```typescript
  {
    logo?: string | 'null'           // 'null' to remove the image
    status?: 'published' | 'unpublished'
    vanityPath?: string              // URL-friendly path
    theme?: string                   // Themes are hardcoded on the frontend currently, see WEBSITE_THEMES constant
    main?: {
      tagline?: string
      image?: string | 'null'        // 'null' to remove the image
    }
    about?: {
      bio?: string
      issues?: Array<{
        title?: string
        description?: string
      }>
    }
    contact?: {
      address?: string
      email?: string
      phone?: string
    }
  }
  ```

- **File Uploads:** Also accepts logo and hero image uploads, by sending the image files in the `heroFile` and `logoFile` keys.
- **Content Merging:** Uses deep merge to combine updates with existing content.
- **Array Handling:** Issues array is replaced entirely, to avoid merging an old array with the new value.

> ⚠️ **NOTE:** For the `logo` and `main.image` fields, you _could_ sent an external URL to use as the image path, but primarily images would be uploaded as files along with the request paylod. Currently, these fields are only used when removing the logo or main image from the content.

#### Retrieving Website Data

**GET** `/websites/mine`

- Returns the current user's website with domain information
- Includes campaign details and user information

#### Managing Contacts

**GET** `/websites/mine/contacts`

- Retrieves contact form submissions with pagination
- **Query Parameters:**
  - `sortBy`: Field to sort by (createdAt, name, email, etc.)
  - `sortOrder`: 'asc' or 'desc' (default: 'desc')
  - `limit`: Number of contacts per page (default: 25)
  - `page`: Page number (default: 1)
- Returns paginated results with total count and page info

#### Site Views

**GET** `/websites/mine/views`

- Retrieves website view records with date range filtering
- **Query Parameters:**
  - `startDate`: Start date for analytics (optional)
  - `endDate`: End date for analytics (optional)

#### Vanity Path Validation

**POST** `/websites/mine/validate-vanity-path`

- Validates if a vanity path is available for use
- Checks for uniqueness and format requirements
- Returns validation result

#### Preview Website

**GET** `/websites/:vanityPath/preview`

- Owner or Admin only endpoint to preview unpublished websites
- Requires admin role, or campaign ownership to access
- Returns website content for preview purposes

#### Public Website Access

**GET** `/websites/:vanityPath/view`

- Public endpoint to view published websites
- Returns website content and campaign information
- Only accessible for websites with 'published' status

#### Contact Form Submission

**POST** `/websites/:vanityPath/contact`

- Public endpoint for contact form submissions
- **Payload Structure:**
  ```typescript
  {
    name: string
    email: string
    phone?: string
    message: string
    smsConsent: boolean
  }
  ```
- Stores contact information with SMS consent tracking
- No authentication required (public endpoint)

#### View Tracking

**POST** `/websites/:vanityPath/track`

- Tracks website views for analytics
- **Payload Structure:**
  ```typescript
  {
    visitorId: string // UUID generated by frontend
  }
  ```
- Rate-limited to prevent refreshing spams (1 minute window per visitor) **Very flimsy limiting however**
- No authentication required (public endpoint)
  > ⚠️ **NOTE:** This is implementation is good enough for the short term, but at some point a more robust site analytics tool could be used (Segment/Amplitude or similar)

### Domain Management (DomainsController)

#### Domain Search

**GET** `/domains/search`

- Searches for domain availability and pricing information
- **Query Parameters:**
  - `domain`: Domain name to search (e.g., "example.com")
- **Returns:**
  - Domain availability status
  - Registration and renewal pricing
  - Alternative domain suggestions with pricing

#### Domain Details (Admin Only)

**GET** `/domains`

- Admin-only endpoint to get detailed domain information
- **Not really used just for development**
- **Query Parameters:**
  - `domain`: Domain name to get details for
- Returns domain details straight from Vercel. Note this does **not** check our own `domain` table first, so it will answer for any domain in the Vercel team, including GoodParty infrastructure domains
- Requires admin role

#### Transfer Auth Code

**GET** `/domains/auth-code`

- Returns the registrar auth (EPP) code a candidate needs to transfer their domain to another registrar
- **Query Parameters:**
  - `domain`: Domain name to issue the code for
  - `actorEmail`: Required only for machine-token callers, naming the admin on whose behalf the call is made
- Unlike `GET /domains`, this **does** check our own `domain` table first and refuses any name not registered for a campaign, so GoodParty infrastructure domains cannot be pulled through it
- `AdminOrM2MGuard` rather than `@Roles(admin)`, so `gp-admin` can reach it with its machine token. Every issuance is logged with the acting human's email
- Issuing a code hands control of the domain to whoever holds it, and it cannot be revoked. Vercel refuses during ICANN's 60-day post-registration lock, which surfaces as a 4xx naming the date the lock lifts

#### Domain Search

**GET** `/domains/search`

- **Query Parameters:**
  - `domain`: Single domain name to check
- Returns availability and price for that one name

**POST** `/domains/search`

- Pattern search for the calling campaign, also exposed as an MCP tool
- **Payload Structure:**
  ```typescript
  {
    patterns: string[]  // bare SLDs, or names with an approved TLD
    maxPrice: number    // per-domain cap
  }
  ```
- Bare SLDs are fanned out across the approved campaign TLDs only (see `SUPPORTED_TLDS`) — `.com` / `.org` / `.net` are never offered
- Returns `{ candidates: [{ domain, price }] }`, available names only. An empty list means nothing matched under the cap
- Availability comes from Route 53, pricing from Vercel
- Read-only and safe to retry

#### Purchase Domain

**POST** `/domains/purchase`

- Registers a searched domain for the calling campaign. Replaces the old `POST /domains` + `POST /domains/complete` pair
- **Payload Structure:**
  ```typescript
  {
    domain: string
    maxPrice: number // same cap the search was run with
  }
  ```
- **Process:**
  1. Re-checks the live Vercel price against `maxPrice` and rejects with 409 if it moved between search and purchase
  2. Buys through the Vercel registrar with `autoRenew: true` and GoodParty's own contact details as WHOIS registrant
  3. Attaches the domain to the Vercel project
  4. Records the registrar order id as `operationId` and moves the domain to `submitted`
- Idempotent per campaign via a Postgres advisory transaction lock, so it is safe to retry. A repeated call for the same domain returns `alreadyExisted: true`
- `source` is recorded as `agentic` when the caller presents an agent token, otherwise `manual`
- Returns 202, and `submitted` is where this flow ends. Nothing advances the domain past `submitted` on its own, so a caller polling for `registered` is really waiting on `POST /domains/configure`

#### Check Registration Status

**GET** `/domains/status`

- Reports the campaign's stored domain status alongside its Stripe payment status
- Reads our own `domain` row and Stripe — it does **not** poll Vercel, so it only ever reports a transition some other call already wrote. The purchase flow's registrar-order polling drives `pending` → `submitted`; `POST /domains/configure` is the only writer of `registered`
- `active` also maps to `SUCCESSFUL`, but nothing in the codebase ever sets it. `registered` is the terminal success state in practice
- Returns `NO_DOMAIN` when the campaign has a website but no domain row

#### Configure Domain

**POST** `/domains/configure`

- **Process:**
  1. Calls Vercel's verify-project-domain for the campaign's domain
  2. Updates domain status to `registered`
- No DNS records are set by hand and no A record is pointed anywhere: the domain is registered through Vercel, so Vercel already holds the nameservers. Attaching the domain to the project happens during purchase, not here
- Auto-renew is **not** disabled here or anywhere else. Domains stay on `autoRenew: true` for the life of our registration, on the grounds that a lapsed domain mid-campaign is worse than an unwanted renewal
- Call this once the domain reaches `submitted`, i.e. once the registrar order has been accepted. Do **not** wait for `registered` first: this endpoint is the only code path that writes `registered`, so a caller polling for it before calling here waits forever

#### Delete Domain

**DELETE** `/domains`

- Removes the domain from the Vercel project and deletes the `domain` row
- Does **not** cancel the registration with the registrar — the name stays in GoodParty's Vercel account until it expires
