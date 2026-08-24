export const CONTEXT_CATEGORY = {
  ORGANISATION: 'ORGANISATION',
  MONOGRAPH: 'MONOGRAPH',
  REFERENCE_STANDARDS: 'REFERENCE_STANDARDS',
  ANALYTICAL: 'ANALYTICAL',
  IMPURITIES: 'IMPURITIES',
  REGULATORY: 'REGULATORY',
  DOSAGE_FORM: 'DOSAGE_FORM',
  ABBREVIATION: 'ABBREVIATION',
};

const IPC_SOURCE = {
  name: 'Indian Pharmacopoeia Commission',
  url: 'https://www.ipc.gov.in/',
  retrievedAt: '2026-08-24',
};

const CDSCO_SOURCE = {
  name: 'Central Drugs Standard Control Organisation',
  url: 'https://cdsco.gov.in/',
  retrievedAt: '2026-08-24',
};

const DCA_SOURCE = {
  name: 'Drugs and Cosmetics Act, 1940 and Rules, 1945',
  url: 'https://cdsco.gov.in/opencms/opencms/en/Acts-and-Rules/',
  retrievedAt: '2026-08-24',
};

const SEED_ENTRIES = [
  {
    id: 'IPC',
    term: 'Indian Pharmacopoeia Commission',
    aliases: ['IPC', 'pharmacopoeia commission'],
    category: CONTEXT_CATEGORY.ORGANISATION,
    definition:
      'Autonomous institution under the Ministry of Health & Family Welfare, Government of India, responsible for setting official standards for drugs manufactured and marketed in India through the Indian Pharmacopoeia.',
    source: IPC_SOURCE,
    verified: true,
  },
  {
    id: 'IP',
    term: 'Indian Pharmacopoeia',
    aliases: ['IP', 'indian pharmacopoeia'],
    category: CONTEXT_CATEGORY.ORGANISATION,
    definition:
      'The official book of drug standards for India, published by the IPC. Compliance with the current IP is a legal requirement under the Drugs and Cosmetics Act for drugs claiming IP status.',
    source: IPC_SOURCE,
    verified: true,
  },
  {
    id: 'PVPI',
    term: 'Pharmacovigilance Programme of India',
    aliases: ['PvPI', 'pharmacovigilance'],
    category: CONTEXT_CATEGORY.ORGANISATION,
    definition:
      'National programme coordinated by the IPC as the National Coordination Centre, monitoring adverse drug reactions and drug safety across India.',
    source: IPC_SOURCE,
    verified: true,
  },
  {
    id: 'MONOGRAPH',
    term: 'Monograph',
    aliases: ['monograph', 'monographs'],
    category: CONTEXT_CATEGORY.MONOGRAPH,
    definition:
      'The official IP entry for a substance or preparation, stating its definition, identification tests, purity limits, assay method and other requirements that a product must meet to claim IP compliance.',
    source: IPC_SOURCE,
    verified: true,
  },
  {
    id: 'MONOGRAPH_REVISION',
    term: 'Monograph revision',
    aliases: ['monograph revision', 'revision of monograph', 'addendum'],
    category: CONTEXT_CATEGORY.MONOGRAPH,
    definition:
      'The formal process by which an existing IP monograph is amended, published either in a new IP edition or in an addendum. Proposed revisions are circulated for public comment before adoption.',
    source: IPC_SOURCE,
    verified: true,
  },
  {
    id: 'SPECIFICATION',
    term: 'Specification',
    aliases: ['specification', 'specifications', 'spec'],
    category: CONTEXT_CATEGORY.MONOGRAPH,
    definition:
      'The list of tests, references to analytical procedures and acceptance criteria that a drug substance or drug product must conform to.',
    source: IPC_SOURCE,
    verified: true,
  },
  {
    id: 'IPRS',
    term: 'Indian Pharmacopoeia Reference Substance',
    aliases: ['IPRS', 'reference substance', 'reference standard', 'reference standards'],
    category: CONTEXT_CATEGORY.REFERENCE_STANDARDS,
    definition:
      'Authentic specimens established and supplied by the IPC for use in tests and assays prescribed in the Indian Pharmacopoeia. IPRS are issued with a certificate stating the assigned content and recommended use.',
    source: IPC_SOURCE,
    verified: true,
  },
  {
    id: 'WORKING_STANDARD',
    term: 'Working standard',
    aliases: ['working standard', 'secondary standard'],
    category: CONTEXT_CATEGORY.REFERENCE_STANDARDS,
    definition:
      'An in-house standard qualified against a primary reference substance such as an IPRS, used for routine analysis to conserve the primary standard.',
    source: IPC_SOURCE,
    verified: true,
  },
  {
    id: 'COA',
    term: 'Certificate of Analysis',
    aliases: ['certificate of analysis', 'CoA', 'COA', 'certificate'],
    category: CONTEXT_CATEGORY.REFERENCE_STANDARDS,
    definition:
      'A document issued with a batch or reference substance stating the tests performed, the results obtained and the acceptance criteria applied.',
    source: IPC_SOURCE,
    verified: true,
  },
  {
    id: 'ASSAY',
    term: 'Assay',
    aliases: ['assay', 'content determination', 'potency'],
    category: CONTEXT_CATEGORY.ANALYTICAL,
    definition:
      'The quantitative determination of the active ingredient content in a substance or preparation, expressed against the limits stated in the relevant monograph.',
    source: IPC_SOURCE,
    verified: true,
  },
  {
    id: 'DISSOLUTION',
    term: 'Dissolution test',
    aliases: ['dissolution', 'dissolution test', 'dissolution profile'],
    category: CONTEXT_CATEGORY.ANALYTICAL,
    definition:
      'A test measuring the rate and extent to which an active ingredient is released from a solid dosage form into a specified medium under defined apparatus and conditions.',
    source: IPC_SOURCE,
    verified: true,
  },
  {
    id: 'HPLC',
    term: 'High Performance Liquid Chromatography',
    aliases: ['HPLC', 'liquid chromatography', 'chromatography', 'chromatographic'],
    category: CONTEXT_CATEGORY.ANALYTICAL,
    definition:
      'A separation technique widely prescribed in IP monographs for identification, assay and related-substances testing, with system suitability requirements stated in the general chapters.',
    source: IPC_SOURCE,
    verified: true,
  },
  {
    id: 'SYSTEM_SUITABILITY',
    term: 'System suitability',
    aliases: ['system suitability', 'system suitability test'],
    category: CONTEXT_CATEGORY.ANALYTICAL,
    definition:
      'Checks performed to verify that a chromatographic system is adequate for the intended analysis, covering parameters such as resolution, tailing factor, theoretical plates and repeatability.',
    source: IPC_SOURCE,
    verified: true,
  },
  {
    id: 'STABILITY',
    term: 'Stability study',
    aliases: ['stability', 'stability study', 'shelf life', 'accelerated stability'],
    category: CONTEXT_CATEGORY.ANALYTICAL,
    definition:
      'Studies establishing how the quality of a drug substance or product varies with time under defined temperature, humidity and light conditions, used to assign a retest period or shelf life.',
    source: CDSCO_SOURCE,
    verified: true,
  },
  {
    id: 'LOD',
    term: 'Limit of Detection',
    aliases: ['LOD', 'limit of detection'],
    category: CONTEXT_CATEGORY.ANALYTICAL,
    definition:
      'The lowest amount of analyte in a sample that can be detected but not necessarily quantitated as an exact value.',
    source: IPC_SOURCE,
    verified: true,
  },
  {
    id: 'LOQ',
    term: 'Limit of Quantitation',
    aliases: ['LOQ', 'limit of quantitation', 'limit of quantification'],
    category: CONTEXT_CATEGORY.ANALYTICAL,
    definition:
      'The lowest amount of analyte in a sample that can be quantitatively determined with acceptable precision and accuracy.',
    source: IPC_SOURCE,
    verified: true,
  },
  {
    id: 'LOSS_ON_DRYING',
    term: 'Loss on drying',
    aliases: ['loss on drying', 'LOD test', 'moisture content'],
    category: CONTEXT_CATEGORY.ANALYTICAL,
    definition:
      'A test determining the amount of volatile matter, chiefly water, driven off from a substance under specified conditions.',
    source: IPC_SOURCE,
    verified: true,
  },
  {
    id: 'UNIFORMITY_OF_CONTENT',
    term: 'Uniformity of content',
    aliases: ['uniformity of content', 'content uniformity', 'uniformity of dosage units'],
    category: CONTEXT_CATEGORY.ANALYTICAL,
    definition:
      'A test verifying that individual dosage units within a batch contain the labelled amount of active ingredient within the limits prescribed by the IP general chapter.',
    source: IPC_SOURCE,
    verified: true,
  },
  {
    id: 'METHOD_VALIDATION',
    term: 'Analytical method validation',
    aliases: ['method validation', 'analytical validation', 'method verification'],
    category: CONTEXT_CATEGORY.ANALYTICAL,
    definition:
      'Documented evidence that an analytical procedure is suitable for its intended purpose, covering specificity, linearity, accuracy, precision, range, detection and quantitation limits, and robustness.',
    source: CDSCO_SOURCE,
    verified: true,
  },
  {
    id: 'IMPURITY',
    term: 'Impurity',
    aliases: ['impurity', 'impurities', 'related substance', 'related substances'],
    category: CONTEXT_CATEGORY.IMPURITIES,
    definition:
      'Any component of a drug substance or product that is not the active ingredient or an excipient. IP monographs specify identified, unidentified and total impurity limits.',
    source: IPC_SOURCE,
    verified: true,
  },
  {
    id: 'DEGRADATION_PRODUCT',
    term: 'Degradation product',
    aliases: ['degradation product', 'degradant', 'degradants'],
    category: CONTEXT_CATEGORY.IMPURITIES,
    definition:
      'An impurity arising from chemical change in the drug substance during manufacture or storage, distinct from process-related impurities.',
    source: IPC_SOURCE,
    verified: true,
  },
  {
    id: 'RESIDUAL_SOLVENT',
    term: 'Residual solvent',
    aliases: ['residual solvent', 'residual solvents', 'organic volatile impurities'],
    category: CONTEXT_CATEGORY.IMPURITIES,
    definition:
      'Organic volatile chemicals used or produced during manufacture that remain in the finished substance, controlled to limits based on their toxicity class.',
    source: IPC_SOURCE,
    verified: true,
  },
  {
    id: 'ELEMENTAL_IMPURITY',
    term: 'Elemental impurity',
    aliases: ['elemental impurity', 'elemental impurities', 'heavy metals'],
    category: CONTEXT_CATEGORY.IMPURITIES,
    definition:
      'Metallic and semi-metallic residues arising from catalysts, equipment or container closure systems, controlled against permitted daily exposure limits.',
    source: IPC_SOURCE,
    verified: true,
  },
  {
    id: 'API',
    term: 'Active Pharmaceutical Ingredient',
    aliases: ['API', 'active pharmaceutical ingredient', 'drug substance', 'active ingredient'],
    category: CONTEXT_CATEGORY.ABBREVIATION,
    definition:
      'The substance in a pharmaceutical product intended to furnish pharmacological activity or otherwise have a direct effect in the diagnosis, cure, mitigation, treatment or prevention of disease.',
    source: CDSCO_SOURCE,
    verified: true,
  },
  {
    id: 'EXCIPIENT',
    term: 'Excipient',
    aliases: ['excipient', 'excipients', 'inactive ingredient'],
    category: CONTEXT_CATEGORY.DOSAGE_FORM,
    definition:
      'A substance other than the active ingredient included in a dosage form to aid manufacture, protect, support or enhance stability, bioavailability or patient acceptability.',
    source: IPC_SOURCE,
    verified: true,
  },
  {
    id: 'DOSAGE_FORM',
    term: 'Dosage form',
    aliases: ['dosage form', 'dosage forms', 'tablet', 'capsule', 'injection', 'suspension'],
    category: CONTEXT_CATEGORY.DOSAGE_FORM,
    definition:
      'The physical form in which a drug is presented, such as tablets, capsules, injections, oral liquids or topical preparations, each governed by the relevant IP general chapter.',
    source: IPC_SOURCE,
    verified: true,
  },
  {
    id: 'BATCH',
    term: 'Batch',
    aliases: ['batch', 'batch number', 'lot', 'lot number'],
    category: CONTEXT_CATEGORY.REGULATORY,
    definition:
      'A defined quantity of material produced in a single manufacturing cycle, uniquely identified so that its manufacturing and testing history can be traced.',
    source: DCA_SOURCE,
    verified: true,
  },
  {
    id: 'CDSCO',
    term: 'Central Drugs Standard Control Organisation',
    aliases: ['CDSCO', 'drug controller', 'DCGI'],
    category: CONTEXT_CATEGORY.REGULATORY,
    definition:
      'India’s national drug regulatory authority, responsible for approval of new drugs, clinical trials, import licences and enforcement. Regulatory approvals are granted by CDSCO, not by the IPC.',
    source: CDSCO_SOURCE,
    verified: true,
  },
  {
    id: 'DRUGS_AND_COSMETICS_ACT',
    term: 'Drugs and Cosmetics Act, 1940',
    aliases: ['drugs and cosmetics act', 'D&C Act', 'drugs and cosmetics rules'],
    category: CONTEXT_CATEGORY.REGULATORY,
    definition:
      'The primary Indian legislation regulating the import, manufacture, distribution and sale of drugs and cosmetics. The Second Schedule gives the Indian Pharmacopoeia its statutory standing.',
    source: DCA_SOURCE,
    verified: true,
  },
  {
    id: 'GMP',
    term: 'Good Manufacturing Practice',
    aliases: ['GMP', 'good manufacturing practice', 'schedule M'],
    category: CONTEXT_CATEGORY.REGULATORY,
    definition:
      'The quality assurance requirements ensuring medicinal products are consistently produced and controlled to the standards appropriate to their intended use. In India these are prescribed under Schedule M of the Drugs and Cosmetics Rules.',
    source: DCA_SOURCE,
    verified: true,
  },
  {
    id: 'NABL',
    term: 'National Accreditation Board for Testing and Calibration Laboratories',
    aliases: ['NABL', 'accredited laboratory', 'laboratory accreditation'],
    category: CONTEXT_CATEGORY.REGULATORY,
    definition:
      'The Indian accreditation body for testing and calibration laboratories. NABL accreditation is commonly required for laboratories issuing analytical results for regulatory purposes.',
    source: {
      name: 'National Accreditation Board for Testing and Calibration Laboratories',
      url: 'https://nabl-india.org/',
      retrievedAt: '2026-08-24',
    },
    verified: true,
  },
  {
    id: 'PHARMACOPOEIAL_EQUIVALENCE',
    term: 'Pharmacopoeial equivalence',
    aliases: ['pharmacopoeial equivalence', 'harmonisation', 'BP', 'USP', 'Ph. Eur.'],
    category: CONTEXT_CATEGORY.REGULATORY,
    definition:
      'The question of whether a product meeting one pharmacopoeia, such as BP, USP or Ph. Eur., also satisfies the corresponding IP monograph. Equivalence is not automatic and must be assessed test by test.',
    source: IPC_SOURCE,
    verified: false,
  },
  {
    id: 'COMPLIANCE',
    term: 'IP compliance',
    aliases: ['compliance', 'IP compliant', 'conformity'],
    category: CONTEXT_CATEGORY.REGULATORY,
    definition:
      'A claim that a product conforms to the requirements of its Indian Pharmacopoeia monograph, which requires meeting every test and acceptance criterion in the current edition.',
    source: IPC_SOURCE,
    verified: true,
  },
  {
    id: 'GENERAL_CHAPTER',
    term: 'General chapter',
    aliases: ['general chapter', 'general chapters', 'general notices'],
    category: CONTEXT_CATEGORY.MONOGRAPH,
    definition:
      'Sections of the Indian Pharmacopoeia setting out procedures, apparatus and requirements referenced by individual monographs, together with the General Notices governing their interpretation.',
    source: IPC_SOURCE,
    verified: true,
  },
  {
    id: 'STERILITY',
    term: 'Sterility test',
    aliases: ['sterility', 'sterility test', 'sterile'],
    category: CONTEXT_CATEGORY.ANALYTICAL,
    definition:
      'A test demonstrating the absence of viable micro-organisms in preparations required to be sterile, performed under the conditions prescribed in the relevant IP general chapter.',
    source: IPC_SOURCE,
    verified: true,
  },
  {
    id: 'BET',
    term: 'Bacterial Endotoxin Test',
    aliases: ['bacterial endotoxin', 'endotoxin', 'BET', 'pyrogen'],
    category: CONTEXT_CATEGORY.ANALYTICAL,
    definition:
      'A test quantifying bacterial endotoxins in parenteral preparations, with limits stated in the individual monograph.',
    source: IPC_SOURCE,
    verified: true,
  },
  {
    id: 'DISINTEGRATION',
    term: 'Disintegration test',
    aliases: ['disintegration', 'disintegration test'],
    category: CONTEXT_CATEGORY.ANALYTICAL,
    definition:
      'A test measuring the time taken for a solid dosage form to break apart under specified conditions, applied where a dissolution requirement is not prescribed.',
    source: IPC_SOURCE,
    verified: true,
  },
  {
    id: 'BIOEQUIVALENCE',
    term: 'Bioequivalence',
    aliases: ['bioequivalence', 'bioavailability', 'BA/BE'],
    category: CONTEXT_CATEGORY.REGULATORY,
    definition:
      'The demonstration that two pharmaceutically equivalent products deliver comparable rate and extent of active ingredient absorption. Bioequivalence requirements fall under CDSCO, not the pharmacopoeia.',
    source: CDSCO_SOURCE,
    verified: true,
  },
  {
    id: 'OOS',
    term: 'Out of Specification',
    aliases: ['out of specification', 'OOS', 'out of trend', 'OOT'],
    category: CONTEXT_CATEGORY.ANALYTICAL,
    definition:
      'A test result falling outside the acceptance criteria stated in the specification, requiring documented investigation before any conclusion about batch quality is drawn.',
    source: CDSCO_SOURCE,
    verified: true,
  },
  {
    id: 'SHELF_LIFE',
    term: 'Shelf life',
    aliases: ['shelf life', 'expiry', 'expiry date', 'retest period'],
    category: CONTEXT_CATEGORY.REGULATORY,
    definition:
      'The period during which a drug product is expected to remain within its approved specification when stored under the labelled conditions.',
    source: CDSCO_SOURCE,
    verified: true,
  },
];

const FAQ_SOURCE = {
  name: 'IPC Frequently Asked Questions — IP and IPRS',
  url: 'https://iponline.ipc.gov.in/jspui/',
  retrievedAt: '2026-08-24',
};

const GD01_SOURCE = {
  name: 'IPC Guidance Document IPC/GD/01 — Legal Status of Indian Pharmacopoeia',
  url: 'https://iponline.ipc.gov.in/jspui/',
  retrievedAt: '2026-08-24',
};

const CORPUS_ENTRIES = [
  {
    id: 'IPC_NOT_A_REGULATOR',
    term: 'IPC role in drug approval',
    aliases: ['drug approval', 'marketing authorisation', 'regulatory approval', 'approve a drug'],
    category: CONTEXT_CATEGORY.REGULATORY,
    definition:
      'The IPC sets and publishes official drug standards and has no role in the regulatory review or approval of drugs in India. Under the Drugs and Cosmetics Act 1940, the Central Drugs Standard Control Organisation (CDSCO) and the State Licensing Authorities (SLAs) are the competent authorities for regulatory decisions.',
    source: { ...FAQ_SOURCE, section: 'Q2. Does the IPC have any role in drug approval process?' },
    verified: true,
  },
  {
    id: 'IPC_PUBLICATION_TYPES',
    term: 'IPC publication types',
    aliases: ['edition', 'addendum', 'corrigenda', 'corrigendum', 'official publication'],
    category: CONTEXT_CATEGORY.ORGANISATION,
    definition:
      'An Edition of the IP and an Addendum both become official from the effective date printed in the book. An Amendment List is official and takes effect immediately unless stated otherwise. Notices and Updates are informative and are usually NOT official text unless explicitly stated. Corrigenda correct an already-issued amendment list, notice or update.',
    source: {
      ...FAQ_SOURCE,
      section: 'Q5. What are different types of publications issued by the IPC?',
    },
    verified: true,
  },
  {
    id: 'IP_ONLINE',
    term: 'IP Online',
    aliases: ['IP Online', 'iponline', 'digital IP'],
    category: CONTEXT_CATEGORY.ORGANISATION,
    definition:
      'The digital version of the Indian Pharmacopoeia providing access to IP monographs and associated IP Reference Substances with advanced search. Subscriptions are taken at www.iponline.ipc.gov.in.',
    source: { ...FAQ_SOURCE, section: 'Q4. What is IP Online and how to subscribe it?' },
    verified: true,
  },
  {
    id: 'IP_LEGAL_BASIS',
    term: 'Second Schedule, Drugs and Cosmetics Act 1940',
    aliases: ['second schedule', 'section 8', 'section 16', 'standard quality'],
    category: CONTEXT_CATEGORY.REGULATORY,
    definition:
      'The Indian Pharmacopoeia is the official book of standards for drugs in India under the Second Schedule of the Drugs and Cosmetics Act 1940. Section 8 (standards of quality for imported drugs) and Section 16 both refer to the standard set out in the Second Schedule, which makes IP standards legally enforceable.',
    source: { ...GD01_SOURCE, section: 'Introduction' },
    verified: true,
  },
  {
    id: 'FLEXIBLE_MONOGRAPH',
    term: 'Flexible monograph approach',
    aliases: ['flexible monograph', 'prolonged-release dissolution', 'multiple dissolution specifications'],
    category: CONTEXT_CATEGORY.MONOGRAPH,
    definition:
      'For prolonged-release formulations the IP may carry multiple dissolution specifications within a single monograph. The product label must then state which dissolution method number applies to that product.',
    source: {
      name: 'IPC Update, 4 February 2022 — Dissolution Test in Prolonged-release Formulations',
      url: 'https://iponline.ipc.gov.in/jspui/',
      retrievedAt: '2026-08-24',
      section: 'Adoption of the flexible monograph approach',
    },
    verified: true,
  },
  {
    id: 'AMENDMENT_LIST',
    term: 'Amendment List',
    aliases: ['amendment list', 'AL-01', 'AL-04', 'AL-05', 'errata'],
    category: CONTEXT_CATEGORY.MONOGRAPH,
    definition:
      'An official errata document issued by the IPC against a published IP edition, structured as page-referenced "Change from / to", "Insert before" and "Delete" instructions. An amendment states only what changed and must be read together with the base monograph.',
    source: {
      ...FAQ_SOURCE,
      section: 'Q5. What are different types of publications issued by the IPC?',
    },
    verified: true,
  },
  {
    id: 'IP_2022_DATES',
    term: 'Indian Pharmacopoeia 2022',
    aliases: ['IP 2022', '9th edition', 'ninth edition'],
    category: CONTEXT_CATEGORY.ORGANISATION,
    definition:
      'The 9th Edition of the Indian Pharmacopoeia was released on 1 July 2022 and became effective from 1 December 2022. Amendment List 01 to IP 2022 also took effect from 1 December 2022.',
    source: {
      name: 'Amendment List 01 to IP 2022, F. No. T. 11015/01/2020-AR&D',
      url: 'https://iponline.ipc.gov.in/jspui/',
      retrievedAt: '2026-08-24',
      section: 'Covering letter, 28 November 2022',
    },
    verified: true,
  },
  {
    id: 'EWG',
    term: 'Expert Working Group',
    aliases: ['EWG', 'expert working group', 'scientific body'],
    category: CONTEXT_CATEGORY.ORGANISATION,
    definition:
      'Subject-matter committees of the IPC Scientific Body that develop and review IP standards. Groups include General Chapters, Excipients, Impurity Standard Review, IPRS Review, Medical Devices, Microbiology, Vaccines and Immunosera, Veterinary Products and others.',
    source: {
      name: 'IPC Expert Working Groups, IP Addendum 2024',
      url: 'https://iponline.ipc.gov.in/jspui/',
      retrievedAt: '2026-08-24',
      section: 'Expert Working Groups',
    },
    verified: true,
  },
  {
    id: 'SLA',
    term: 'State Licensing Authority',
    aliases: ['SLA', 'state licensing authority', 'state drug controller'],
    category: CONTEXT_CATEGORY.REGULATORY,
    definition:
      'State-level drug regulatory authorities which, together with CDSCO, are competent to take regulatory decisions under the Drugs and Cosmetics Act 1940.',
    source: { ...FAQ_SOURCE, section: 'Q2. Does the IPC have any role in drug approval process?' },
    verified: true,
  },
  {
    id: 'RS_VS_IPRS',
    term: 'Reference Substance (RS) versus IPRS',
    aliases: ['RS', 'reference substance designation'],
    category: CONTEXT_CATEGORY.REFERENCE_STANDARDS,
    definition:
      'Older IP editions designate reference materials as "RS"; the current designation is "IPRS". Several amendments were issued specifically to replace a plain substance name with the named IPRS, so the two are not interchangeable when citing a monograph requirement.',
    source: {
      name: 'Amendment Lists to IP 2022',
      url: 'https://iponline.ipc.gov.in/jspui/',
      retrievedAt: '2026-08-24',
    },
    verified: true,
  },
  {
    id: 'AAS_FP',
    term: 'AAS and FP reagent grades',
    aliases: ['AAS', 'atomic absorption spectrometry', 'FP', 'flame photometry'],
    category: CONTEXT_CATEGORY.ANALYTICAL,
    definition:
      'In IP reagent names, "AAS" denotes a solution of Atomic Absorption Spectrometry grade and "FP" a Flame Photometry grade, as in "magnesium solution AAS" or "sodium solution FP". They are grade suffixes on the reagent, not abbreviations of a method being prescribed.',
    source: {
      name: 'Amendment List 04 to IP 2022',
      url: 'https://iponline.ipc.gov.in/jspui/',
      retrievedAt: '2026-08-24',
    },
    verified: true,
  },
  {
    id: 'CCSEA',
    term: 'Committee for Control and Supervision of Experiments on Animals',
    aliases: ['CCSEA', 'CPCSEA'],
    category: CONTEXT_CATEGORY.REGULATORY,
    definition:
      'The Indian committee governing animal experimentation, formerly CPCSEA. Amendment List 04 to IP 2022 replaced references to "CPCSEA guideline" with "CCSEA guidelines".',
    source: {
      name: 'Amendment List 04 to IP 2022',
      url: 'https://iponline.ipc.gov.in/jspui/',
      retrievedAt: '2026-08-24',
    },
    verified: true,
  },
  {
    id: 'PDG',
    term: 'Pharmacopoeial Discussion Group',
    aliases: ['PDG', 'pharmacopoeial discussion group'],
    category: CONTEXT_CATEGORY.ORGANISATION,
    definition:
      'An international group harmonising pharmacopoeial standards among the European, Japanese and United States Pharmacopoeias. The IPC joined the PDG in October 2023.',
    source: {
      name: 'IPC Update, 18 March 2024 — IPC–USP Memorandum of Understanding',
      url: 'https://iponline.ipc.gov.in/jspui/',
      retrievedAt: '2026-08-24',
    },
    verified: true,
  },
  {
    id: 'RRT',
    term: 'Relative retention time',
    aliases: ['RRT', 'relative retention time', 'RRF', 'relative response factor'],
    category: CONTEXT_CATEGORY.ANALYTICAL,
    definition:
      'The retention time of a peak expressed relative to a reference peak in the same chromatogram, used in IP monographs to identify impurities. The related relative response factor (RRF) corrects for differences in detector response between an impurity and the reference substance.',
    source: { ...FAQ_SOURCE, section: 'Q16 and Q17 on RRT and correction factors' },
    verified: true,
  },
];

export const IPC_CONTEXT_ENTRIES = [...SEED_ENTRIES, ...CORPUS_ENTRIES];

const normalise = (value) => String(value || '').toLowerCase();

export function selectContext(text, { limit = 8 } = {}) {
  const haystack = normalise(text);
  if (!haystack.trim()) return [];

  const matches = [];

  for (const entry of IPC_CONTEXT_ENTRIES) {
    const needles = [entry.term, ...(entry.aliases || [])].map(normalise);
    let earliest = -1;

    for (const needle of needles) {
      if (!needle) continue;
      const found = haystack.indexOf(needle);
      if (found !== -1 && (earliest === -1 || found < earliest)) {
        earliest = found;
      }
    }

    if (earliest !== -1) {
      matches.push({ entry, earliest });
    }
  }

  return matches
    .sort((a, b) => a.earliest - b.earliest)
    .slice(0, limit)
    .map((match) => match.entry);
}

export function formatContextForPrompt(entries = []) {
  if (entries.length === 0) return 'No IPC glossary entry matched this enquiry.';

  return entries
    .map((entry) => {
      const trust = entry.verified ? '' : ' [UNVERIFIED — do not present as authoritative]';
      return `- ${entry.term} (${entry.category}): ${entry.definition} [source: ${entry.source?.name || 'unknown'}]${trust}`;
    })
    .join('\n');
}
