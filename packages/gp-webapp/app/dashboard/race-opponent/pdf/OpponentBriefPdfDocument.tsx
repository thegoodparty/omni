'use client'

import {
  Document,
  Link,
  Page,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer'
import type { RaceOpponentSummarySourceRef } from 'gpApi/api-endpoints'
import type {
  OpponentBrief,
  OpponentBriefSection,
} from './opponentBriefContent'

const COLOR = {
  primary: '#0a1428',
  muted: '#6b7280',
  divider: '#d1d5db',
  card: '#f8fafc',
  link: '#0048c2',
}

const styles = StyleSheet.create({
  page: {
    paddingVertical: 48,
    paddingHorizontal: 54,
    fontFamily: 'Helvetica',
    fontSize: 11,
    color: COLOR.primary,
    lineHeight: 1.5,
  },
  docHeader: {
    fontSize: 9,
    color: COLOR.muted,
    marginBottom: 16,
  },
  opponent: {
    marginBottom: 8,
  },
  title: {
    fontSize: 20,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 4,
  },
  snapshot: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: COLOR.primary,
    marginBottom: 12,
    paddingBottom: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: COLOR.divider,
    borderBottomStyle: 'solid',
  },
  section: {
    marginBottom: 12,
  },
  sectionHeading: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: COLOR.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 5,
  },
  sectionHeadingLg: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    color: COLOR.primary,
    marginBottom: 8,
  },
  para: {
    marginBottom: 6,
  },
  bulletRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  bulletDot: {
    width: 12,
  },
  bulletText: {
    flex: 1,
  },
  card: {
    borderWidth: 0.5,
    borderColor: COLOR.divider,
    borderStyle: 'solid',
    borderRadius: 4,
    backgroundColor: COLOR.card,
    padding: 8,
    marginBottom: 6,
  },
  contrast: {
    marginBottom: 12,
  },
  contrastIssue: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 4,
  },
  subLabel: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: COLOR.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  stanceRow: {
    flexDirection: 'row',
    gap: 10,
  },
  stanceCol: {
    flex: 1,
  },
  positionLabel: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 2,
  },
  source: {
    fontSize: 8,
    color: COLOR.link,
    textDecoration: 'underline',
    marginTop: 2,
  },
})

const Sources = ({
  sources,
}: {
  sources: RaceOpponentSummarySourceRef[]
}): React.JSX.Element | null => {
  // De-dupe by URL: per-item source lists carry no uniqueness guarantee, so a
  // repeated sourceUrl from the LLM would collide on the React key and react-pdf
  // would silently drop the second link. Mirrors the overview+background merge
  // dedup in opponentBriefContent.
  // sourceUrl is the legacy passthrough (ENG-10630); url is the rich field the
  // contract always backfills, so it's the stable fallback once sourceUrl
  // stops being sent (ENG-10635).
  const seen = new Set<string>()
  const unique = sources
    .map((source) => source.sourceUrl ?? source.url)
    .filter((url) => {
      if (seen.has(url)) return false
      seen.add(url)
      return true
    })
  if (unique.length === 0) return null
  return (
    <View>
      {unique.map((url) => (
        <Link key={url} src={url} style={styles.source}>
          {url}
        </Link>
      ))}
    </View>
  )
}

const Bullets = ({ items }: { items: string[] }): React.JSX.Element => (
  <View>
    {/* Index keys: whatYouNeedToKnow is free-text from the LLM with no
        uniqueness guarantee, so a repeated string would collide on a
        text-based key and react-pdf would silently drop the duplicate. */}
    {items.map((item, index) => (
      <View key={index} style={styles.bulletRow}>
        <Text style={styles.bulletDot}>•</Text>
        <Text style={styles.bulletText}>{item}</Text>
      </View>
    ))}
  </View>
)

const Section = ({
  section,
  opponentName,
}: {
  section: OpponentBriefSection
  opponentName: string
}): React.JSX.Element => {
  switch (section.kind) {
    case 'overview':
      return (
        <View style={styles.section}>
          {section.paragraphs.map((text, index) => (
            <Text key={index} style={styles.para}>
              {text}
            </Text>
          ))}
          <Sources sources={section.sources} />
        </View>
      )
    case 'whyTheyMatter':
      return (
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Why they matter most</Text>
          <Text>{section.text}</Text>
        </View>
      )
    case 'whatYouNeedToKnow':
      return (
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>What you need to know</Text>
          <Bullets items={section.items} />
        </View>
      )
    case 'whereSoft':
      return (
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Where they&apos;re soft</Text>
          {/* Index keys: whereSoft item text is free-text with no uniqueness
              guarantee; a repeated description on a text-based key would be
              silently dropped by react-pdf. */}
          {section.items.map((item, index) => (
            <View key={index} style={styles.card}>
              <Text>{item.text}</Text>
              <Sources sources={item.sources} />
            </View>
          ))}
        </View>
      )
    case 'issueContrasts':
      return (
        <View style={styles.section}>
          <Text style={styles.sectionHeadingLg}>
            Where you contrast, and what to do about it
          </Text>
          {section.contrasts.map((contrast, index) => (
            <View key={`${contrast.issue}-${index}`} style={styles.contrast}>
              <Text style={styles.contrastIssue}>{contrast.issue}</Text>
              <Text style={styles.subLabel}>
                Why this matters to constituents
              </Text>
              <Text style={styles.para}>{contrast.whyItMatters}</Text>
              <View style={styles.stanceRow}>
                <View style={styles.stanceCol}>
                  <Text style={styles.subLabel}>{opponentName}</Text>
                  <Text>{contrast.opponentStance}</Text>
                  <Sources sources={contrast.opponentSources} />
                </View>
                <View style={styles.stanceCol}>
                  <Text style={styles.subLabel}>You</Text>
                  <Text>{contrast.candidateStance}</Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      )
    case 'keyPositions':
      return (
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Key positions</Text>
          {/* Index keys: position.label is LLM free-text with no uniqueness
              guarantee; a duplicate label on a text-based key would be silently
              dropped by react-pdf. */}
          {section.positions.map((position, index) => (
            <View key={index} style={styles.card}>
              <Text style={styles.positionLabel}>{position.label}</Text>
              <Text>{position.detail}</Text>
              <Sources sources={position.sources} />
            </View>
          ))}
        </View>
      )
  }
}

// The opponent's identity (name + snapshot line) is not part of the on-page
// summary body — it lives in the accordion row — so it's rendered here as the
// brief header to match what the reader sees on screen.
const OpponentBriefView = ({
  brief,
  opponentName,
  breakBefore,
}: {
  brief: OpponentBrief
  opponentName: string
  breakBefore: boolean
}): React.JSX.Element => (
  <View style={styles.opponent} break={breakBefore}>
    <Text style={styles.title}>{brief.title}</Text>
    {brief.snapshot ? (
      <Text style={styles.snapshot}>{brief.snapshot}</Text>
    ) : null}
    {brief.sections.map((section, index) => (
      <Section key={index} section={section} opponentName={opponentName} />
    ))}
  </View>
)

type BriefWithName = { brief: OpponentBrief; opponentName: string }

export const OpponentBriefPdfDocument = ({
  briefs,
  raceContext,
}: {
  briefs: BriefWithName[]
  raceContext?: string
}): React.JSX.Element => (
  <Document title="Opponent brief">
    <Page size="LETTER" style={styles.page}>
      {raceContext ? (
        <Text style={styles.docHeader} fixed>
          {raceContext}
        </Text>
      ) : null}
      {/* Index keys: opponent names carry no uniqueness guarantee, so two
          same-named opponents on a name-based key would collide and one brief
          would be silently dropped. */}
      {briefs.map(({ brief, opponentName }, index) => (
        <OpponentBriefView
          key={index}
          brief={brief}
          opponentName={opponentName}
          breakBefore={index > 0}
        />
      ))}
    </Page>
  </Document>
)
