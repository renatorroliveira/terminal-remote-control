/** The sections of the user guide the app opens directly (A11Y-10.4). */
export const GUIDE_SECTION_NAMES = ['voiceover'] as const;

/** A section of the user guide the app opens directly. */
export type GuideSection = (typeof GUIDE_SECTION_NAMES)[number];

/** Each section's heading id in the guide. */
export const GUIDE_SECTIONS: Readonly<Record<GuideSection, string>> = {
    voiceover: 'quick-start-with-voiceover',
};
