import type {ChatMessage} from '@/types';

/** One thing in the Media screen of a chat. */
export type MediaPhoto = {kind: 'photo'; id: string; at: number; image: string; msg: ChatMessage};
export type MediaVideo = {kind: 'video'; id: string; at: number; thumb?: string; msg: ChatMessage};
export type MediaFile = {kind: 'file' | 'audio' | 'voice'; id: string; at: number; msg: ChatMessage};
export type MediaLink = {kind: 'link'; id: string; at: number; url: string; msg: ChatMessage};
export type MediaVisual = MediaPhoto | MediaVideo;

export type SharedMedia = {
  /** Photos and videos, newest first. */
  visual: MediaVisual[];
  /** Files, audio and voice notes, newest first. */
  files: MediaFile[];
  /** Web links people wrote in messages, newest first. */
  links: MediaLink[];
};

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;

/**
 * Everything shared in one chat, sorted into what the Media screen shows. View-once and removed photos are left out
 * (they are not meant to be kept), and so is anything whose bytes are not on this phone yet.
 */
export function sharedMedia(messages: ChatMessage[]): SharedMedia {
  const visual: MediaVisual[] = [];
  const files: MediaFile[] = [];
  const links: MediaLink[] = [];
  for (const m of messages) {
    if (m.type === 'image') {
      if (m.image && !m.viewOnce && !m.mediaGone) {
        visual.push({kind: 'photo', id: m.id, at: m.timestamp, image: m.image, msg: m});
      }
    } else if (m.type === 'file' && m.file) {
      if (m.file.kind === 'video') {
        visual.push({kind: 'video', id: m.id, at: m.timestamp, thumb: m.file.thumb, msg: m});
      } else {
        files.push({kind: m.file.kind, id: m.id, at: m.timestamp, msg: m});
      }
    }
    if (m.text) {
      const found = m.text.match(URL_RE) ?? [];
      found.forEach((url, i) => links.push({kind: 'link', id: `${m.id}:${i}`, at: m.timestamp, url: url.replace(/[).,;!?]+$/, ''), msg: m}));
    }
  }
  const newest = (a: {at: number}, b: {at: number}) => b.at - a.at;
  return {visual: visual.sort(newest), files: files.sort(newest), links: links.sort(newest)};
}
