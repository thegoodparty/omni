import { User } from '../../../generated/prisma'
import { getUserFullName } from '../../../users/util/users.util'
import { SlackMessageType } from '../../slack/slackService.types'

// Deliberately narrow fields instead of a stringified error: the full Axios
// error carries config.headers.Authorization (a live Peerly bearer token) and
// the request body (a Campaign Verify PIN in cleartext), and this message goes
// to a broadly-readable Slack channel.
interface BuildPeerlySlackErrorMessageParams {
  user: User
  requestSummary?: string
  responseData?: string
  errorMessage?: string
  peerlyIdentityId?: string
}

// An empty rich_text_list makes Slack reject the whole message, so the list is
// omitted rather than emitted empty.
const buildErrorBullets = (...lines: (string | undefined)[]) => {
  const bullets = lines
    .filter((line): line is string => Boolean(line))
    .map((line) => ({
      type: SlackMessageType.RICH_TEXT_SECTION,
      elements: [
        {
          type: SlackMessageType.TEXT,
          text: line,
        },
      ],
    }))
  return bullets.length
    ? [
        {
          type: SlackMessageType.RICH_TEXT_LIST,
          style: 'bullet',
          elements: bullets,
        },
      ]
    : []
}

export const buildPeerlySlackErrorMessage = ({
  user,
  requestSummary,
  responseData,
  errorMessage,
  peerlyIdentityId,
}: BuildPeerlySlackErrorMessageParams) => [
  {
    type: SlackMessageType.HEADER,
    text: {
      type: SlackMessageType.PLAIN_TEXT,
      text: '🚨 TCR/10DLC Compliance Flow Error 🚨',
      emoji: true,
    },
  },
  {
    type: SlackMessageType.RICH_TEXT,
    elements: [
      {
        type: SlackMessageType.RICH_TEXT_SECTION,
        elements: [
          {
            type: SlackMessageType.EMOJI,
            name: 'gp',
          },
          {
            type: SlackMessageType.TEXT,
            text: ` User:`,
            style: {
              bold: true,
            },
          },
        ],
      },
      {
        type: SlackMessageType.RICH_TEXT_LIST,
        style: 'bullet',
        elements: [
          {
            type: SlackMessageType.RICH_TEXT_SECTION,
            elements: [
              {
                type: SlackMessageType.TEXT,
                text: ' Name: ',
                style: {
                  bold: true,
                },
              },
              {
                type: SlackMessageType.TEXT,
                text: String(getUserFullName(user)),
              },
            ],
          },
          {
            type: SlackMessageType.RICH_TEXT_SECTION,
            elements: [
              {
                type: SlackMessageType.TEXT,
                text: ' Email: ',
                style: {
                  bold: true,
                },
              },
              {
                type: SlackMessageType.TEXT,
                text: String(user.email),
              },
            ],
          },
          {
            type: SlackMessageType.RICH_TEXT_SECTION,
            elements: [
              {
                type: SlackMessageType.TEXT,
                text: ' Phone: ',
                style: {
                  bold: true,
                },
              },
              {
                type: SlackMessageType.TEXT,
                text: String(user.phone),
              },
            ],
          },
        ],
      },
      {
        type: SlackMessageType.RICH_TEXT_SECTION,
        elements: [
          {
            type: SlackMessageType.EMOJI,
            name: 'eyeglasses',
          },
          {
            type: SlackMessageType.TEXT,
            text: ` Candidate Peerly Identity ID: ${peerlyIdentityId || 'N/A'}`,
            style: {
              bold: true,
            },
          },
        ],
      },
    ],
  },
  {
    type: SlackMessageType.DIVIDER,
  },
  {
    type: SlackMessageType.RICH_TEXT,
    elements: [
      {
        type: SlackMessageType.RICH_TEXT_SECTION,
        elements: [
          {
            type: SlackMessageType.EMOJI,
            name: 'zap',
          },
          {
            type: SlackMessageType.TEXT,
            text: ' Response Error:',
            style: {
              bold: true,
            },
          },
        ],
      },
      ...buildErrorBullets(requestSummary, errorMessage),
      // Slack only preserves the pretty-printed body's whitespace inside a
      // preformatted element, and rich_text_list accepts rich_text_section
      // children only — so the body is a sibling of the bullets, not one.
      ...(responseData
        ? [
            {
              type: SlackMessageType.RICH_TEXT_PREFORMATTED,
              elements: [
                {
                  type: SlackMessageType.TEXT,
                  text: responseData,
                },
              ],
            },
          ]
        : []),
    ],
  },
]
