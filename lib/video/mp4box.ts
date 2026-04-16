import {
  createFile,
  MP4File,
  MP4Info,
  MP4VideoTrack,
  MP4AudioTrack,
  MP4SubtitleTrack,
} from "mp4box";

export interface MP4TrackInfo {
  video: MP4VideoTrack[];
  audio: MP4AudioTrack[];
  subtitles: MP4SubtitleTrack[];
}

export class MP4BoxPlayer {
  private mp4boxfile: MP4File;
  public info: MP4Info | null = null;
  public videoTrack: MP4VideoTrack | null = null;
  public selectedAudioTrack: MP4AudioTrack | null = null;

  constructor(
    private onReady: (info: MP4TrackInfo) => void,
    private onSegment: (
      id: number,
      user: any,
      buffer: ArrayBuffer,
      sampleNum: number,
      isLast: boolean,
    ) => void,
  ) {
    this.mp4boxfile = createFile();

    // Patch mp4box error handler
    this.mp4boxfile.onError = (e: string) => console.error("MP4Box Error", e);

    this.mp4boxfile.onReady = (info: MP4Info) => {
      this.info = info;
      this.videoTrack = info.videoTracks[0] || null;
      this.selectedAudioTrack = info.audioTracks[0] || null;

      this.onReady({
        video: info.videoTracks,
        audio: info.audioTracks,
        subtitles: info.subtitleTracks,
      });
    };

    this.mp4boxfile.onSegment = this.onSegment;
  }

  public setExtractionTracks(videoId?: number, audioId?: number) {
    if (videoId !== undefined) {
      this.mp4boxfile.setSegmentOptions(videoId, null, { nbSamples: 1000 });
    }
    if (audioId !== undefined) {
      this.mp4boxfile.setSegmentOptions(audioId, null, { nbSamples: 1000 });
    }
  }

  public start() {
    this.mp4boxfile.initializeSegmentation();
    this.mp4boxfile.start();
  }

  public flush() {
    this.mp4boxfile.flush();
  }

  public appendChunk(buffer: ArrayBuffer, offset: number) {
    const buf = buffer as any;
    buf.fileStart = offset;
    this.mp4boxfile.appendBuffer(buf);
  }
}
