// The IMO conventions, held in the app rather than fetched.
//
// This list is unlike the flag circulars. Administrations add notices weekly,
// so those have to be pulled in. The conventions are a closed set that changes
// once every few years — SOLAS has been SOLAS since 1974 — so downloading them
// repeatedly would spend data to be told the same thing. They ship with the
// app instead: available at sea, on no signal, for nothing.
//
// What moves is the amendments, and no list can tell you those. Each entry
// links to the IMO page so the standing text can be checked against the
// source, and "Amendments in force" is left for you to fill in from the
// circulars you hold.
//
// Dates are of adoption and of entry into force. Where a convention has not
// entered into force, or where its date is better checked than asserted, the
// field is left empty rather than guessed at.

export const IMO_LIST_URL =
  'https://www.imo.org/en/about/conventions/pages/listofconventions.aspx';

/**
 * short   — how it is spoken about on board, and the reference it is filed by
 * adopted — year of adoption
 * inForce — year it entered into force, blank if it has not
 * group   — the heading it sits under on the IMO's own list
 */
export const IMO_CONVENTIONS = [
  // ---- Safety ----
  { short: 'SOLAS 1974', adopted: '1974', inForce: '1980', group: 'Safety',
    name: 'International Convention for the Safety of Life at Sea' },
  { short: 'COLREG 1972', adopted: '1972', inForce: '1977', group: 'Safety',
    name: 'Convention on the International Regulations for Preventing Collisions at Sea' },
  { short: 'LOAD LINES 1966', adopted: '1966', inForce: '1968', group: 'Safety',
    name: 'International Convention on Load Lines' },
  { short: 'TONNAGE 1969', adopted: '1969', inForce: '1982', group: 'Safety',
    name: 'International Convention on Tonnage Measurement of Ships' },
  { short: 'SAR 1979', adopted: '1979', inForce: '1985', group: 'Safety',
    name: 'International Convention on Maritime Search and Rescue' },
  { short: 'CSC 1972', adopted: '1972', inForce: '1977', group: 'Safety',
    name: 'International Convention for Safe Containers' },
  { short: 'SUA 1988', adopted: '1988', inForce: '1992', group: 'Safety',
    name: 'Convention for the Suppression of Unlawful Acts against the Safety of Maritime Navigation' },
  { short: 'STP 1971', adopted: '1971', inForce: '1974', group: 'Safety',
    name: 'Special Trade Passenger Ships Agreement' },

  // ---- Pollution prevention ----
  { short: 'MARPOL 73/78', adopted: '1973', inForce: '1983', group: 'Pollution prevention',
    name: 'International Convention for the Prevention of Pollution from Ships' },
  { short: 'LC 1972', adopted: '1972', inForce: '1975', group: 'Pollution prevention',
    name: 'Convention on the Prevention of Marine Pollution by Dumping of Wastes and Other Matter' },
  { short: 'London Protocol 1996', adopted: '1996', inForce: '2006', group: 'Pollution prevention',
    name: 'Protocol to the Convention on the Prevention of Marine Pollution by Dumping' },
  { short: 'INTERVENTION 1969', adopted: '1969', inForce: '1975', group: 'Pollution prevention',
    name: 'International Convention Relating to Intervention on the High Seas in Cases of Oil Pollution Casualties' },
  { short: 'OPRC 1990', adopted: '1990', inForce: '1995', group: 'Pollution prevention',
    name: 'International Convention on Oil Pollution Preparedness, Response and Co-operation' },
  { short: 'AFS 2001', adopted: '2001', inForce: '2008', group: 'Pollution prevention',
    name: 'International Convention on the Control of Harmful Anti-fouling Systems on Ships' },
  { short: 'BWM 2004', adopted: '2004', inForce: '2017', group: 'Pollution prevention',
    name: 'International Convention for the Control and Management of Ships’ Ballast Water and Sediments' },
  { short: 'Hong Kong 2009', adopted: '2009', inForce: '2025', group: 'Pollution prevention',
    name: 'International Convention for the Safe and Environmentally Sound Recycling of Ships' },

  // ---- Liability and compensation ----
  { short: 'CLC 1992', adopted: '1992', inForce: '1996', group: 'Liability and compensation',
    name: 'International Convention on Civil Liability for Oil Pollution Damage' },
  { short: 'FUND 1992', adopted: '1992', inForce: '1996', group: 'Liability and compensation',
    name: 'International Convention on the Establishment of an International Fund for Compensation for Oil Pollution Damage' },
  { short: 'BUNKERS 2001', adopted: '2001', inForce: '2008', group: 'Liability and compensation',
    name: 'International Convention on Civil Liability for Bunker Oil Pollution Damage' },
  { short: 'LLMC 1976', adopted: '1976', inForce: '1986', group: 'Liability and compensation',
    name: 'Convention on Limitation of Liability for Maritime Claims' },
  { short: 'PAL 1974', adopted: '1974', inForce: '1987', group: 'Liability and compensation',
    name: 'Athens Convention relating to the Carriage of Passengers and their Luggage by Sea' },
  { short: 'SALVAGE 1989', adopted: '1989', inForce: '1996', group: 'Liability and compensation',
    name: 'International Convention on Salvage' },
  { short: 'NAIROBI WRC 2007', adopted: '2007', inForce: '2015', group: 'Liability and compensation',
    name: 'Nairobi International Convention on the Removal of Wrecks' },
  { short: 'HNS 2010', adopted: '2010', inForce: '', group: 'Liability and compensation',
    name: 'International Convention on Liability and Compensation for Damage in Connection with the Carriage of Hazardous and Noxious Substances by Sea' },

  // ---- Crewing and other ----
  { short: 'STCW 1978', adopted: '1978', inForce: '1984', group: 'Crewing',
    name: 'International Convention on Standards of Training, Certification and Watchkeeping for Seafarers' },
  { short: 'STCW-F 1995', adopted: '1995', inForce: '2012', group: 'Crewing',
    name: 'International Convention on Standards of Training, Certification and Watchkeeping for Fishing Vessel Personnel' },
  { short: 'FAL 1965', adopted: '1965', inForce: '1967', group: 'Other',
    name: 'Convention on Facilitation of International Maritime Traffic' },
  { short: 'IMO Convention 1948', adopted: '1948', inForce: '1958', group: 'Other',
    name: 'Convention on the International Maritime Organization' },
  { short: 'Cape Town Agreement 2012', adopted: '2012', inForce: '', group: 'Other',
    name: 'Cape Town Agreement on the Torremolinos Protocol for the Safety of Fishing Vessels' }
];

/** How a convention reads once it is filed as a publication. */
export function asPublication(convention) {
  return {
    title: `${convention.name}, ${convention.adopted}`,
    refNo: convention.short,
    edition: convention.inForce
      ? `Adopted ${convention.adopted}, in force ${convention.inForce}`
      : `Adopted ${convention.adopted}, not yet in force`,
    category: 'IMO Convention',
    publisher: 'IMO',
    // Left empty on purpose: what is in force for your ship is the amendments,
    // and those come from the circulars, not from a list of conventions.
    correctedTo: '',
    fileLink: IMO_LIST_URL,
    sourceUrl: IMO_LIST_URL,
    notes: '',
    attachments: []
  };
}

/** Which of the conventions are not already filed, matched on reference. */
export function notHeld(items) {
  const held = new Set(
    items.map((i) => String(i.data.refNo || '').trim().toUpperCase()).filter(Boolean)
  );
  return IMO_CONVENTIONS.filter((c) => !held.has(c.short.toUpperCase()));
}
