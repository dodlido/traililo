// Photos for the places, all from Wikimedia Commons under free licences. They load from Commons when you are online
// (nothing is stored in this repository); if one fails to load, the drawing underneath stays. Credits are shown with each photo.
export interface Photo {
  file: string;
  /** Thumbnail width to ask for. Left out where the original is small. */
  width?: number;
  by: string;
  licence: string;
  /** Which part to keep when the picture is cropped, as a CSS object-position. */
  focus?: string;
}

export const PHOTOS: Record<string, Photo> = {
  'Buenos Aires': { file: 'Buenos_Aires-Puerto_Madero-Hilton-River_View.jpg', width: 960, by: 'Alexis González Molina', licence: 'CC BY-SA 3.0' },
  Ushuaia: { file: 'Beagle_Channel_-k.jpg', width: 1280, by: 'RAYANDBEE', licence: 'CC BY 2.0' },
  'Punta Arenas': { file: '00_2521_Punta_Arenas_-_Chile.jpg', width: 1280, by: 'W. Bulach', licence: 'CC BY-SA 4.0' },
  'Torres del Paine': { file: 'Cuernos_del_Paine_2011.jpg', width: 1280, by: 'Alex Proimos', licence: 'CC BY 2.0', focus: '50% 40%' },
  'El Calafate': { file: 'Perito_Moreno_Glacier_Patagonia_Argentina_Luca_Galuzzi_2005.JPG', width: 1280, by: 'Luca Galuzzi', licence: 'CC BY-SA 2.5' },
  'El Chalten': { file: '162_-_Fitz_Roy_-_Janvier_2010.jpg', width: 1280, by: 'Martin St-Amant', licence: 'CC BY-SA', focus: '50% 35%' },
  'Puerto Rio Tranquilo': { file: 'Capilla_de_Mármol.jpg', width: 960, by: 'Manxuc', licence: 'CC BY-SA 4.0', focus: '50% 55%' },
  Chaiten: { file: 'Chaiten_Volcano_NASA.jpg', by: 'NASA', licence: 'Public domain' },
  Bariloche: { file: 'Lago_Nahuel_Huapi,_Argentina,_2005.jpeg', by: 'Klaus 15', licence: 'CC BY-SA 2.5' },
};

export const photoUrl = (p: Photo) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(p.file)}${p.width ? `?width=${p.width}` : ''}`;
export const photoPage = (p: Photo) => `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(p.file)}`;
export const photoCredit = (p: Photo) => `Photo: ${p.by} · ${p.licence}`;
