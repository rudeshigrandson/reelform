import AVFoundation
import CoreMedia
import Foundation
import ReelformProtocol
import VideoToolbox

/// AVAssetWriter factories (§5.3). All writers use fragmented output
/// (`movieFragmentInterval` = 2s) so a crash leaves a playable file; a clean
/// `finishWriting` rewrites the moov.
enum Writers {
    static let fragmentInterval = CMTime(seconds: 2, preferredTimescale: 600)

    struct Video {
        let writer: AVAssetWriter
        let input: AVAssetWriterInput
        let adaptor: AVAssetWriterInputPixelBufferAdaptor
    }

    struct Audio {
        let writer: AVAssetWriter
        let input: AVAssetWriterInput
    }

    static func video(url: URL, width: Int, height: Int, fps: Int) throws -> Video {
        try? FileManager.default.removeItem(at: url)
        let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        writer.movieFragmentInterval = fragmentInterval
        writer.shouldOptimizeForNetworkUse = false

        let compression: [String: Any] = [
            AVVideoAverageBitRateKey: BitrateTable.bitsPerSecond(width: width, height: height, fps: fps),
            AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
            AVVideoH264EntropyModeKey: AVVideoH264EntropyModeCABAC,
            AVVideoExpectedSourceFrameRateKey: fps,
            AVVideoMaxKeyFrameIntervalKey: BitrateTable.keyframeIntervalFrames(fps: fps),
            AVVideoMaxKeyFrameIntervalDurationKey: BitrateTable.keyframeIntervalSeconds,
            AVVideoAllowFrameReorderingKey: false,
        ]
        let settings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: compression,
            // Prefer the hardware encoder; allow software fallback.
            AVVideoEncoderSpecificationKey: [
                kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder as String: true,
            ],
            AVVideoColorPropertiesKey: [
                AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
                AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
                AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
            ],
        ]
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
        input.expectsMediaDataInRealTime = true
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: input,
            sourcePixelBufferAttributes: [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                kCVPixelBufferWidthKey as String: width,
                kCVPixelBufferHeightKey as String: height,
            ]
        )
        guard writer.canAdd(input) else { throw RecorderError.writer("cannot add video input") }
        writer.add(input)
        guard writer.startWriting() else {
            throw RecorderError.writer(writer.error?.localizedDescription ?? "startWriting failed")
        }
        return Video(writer: writer, input: input, adaptor: adaptor)
    }

    static func aac(url: URL, channels: Int, bitRate: Int) throws -> Audio {
        try? FileManager.default.removeItem(at: url)
        let writer = try AVAssetWriter(outputURL: url, fileType: .m4a)
        writer.movieFragmentInterval = fragmentInterval
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 48_000,
            AVNumberOfChannelsKey: channels,
            AVEncoderBitRateKey: bitRate,
        ]
        let input = AVAssetWriterInput(mediaType: .audio, outputSettings: settings)
        input.expectsMediaDataInRealTime = true
        guard writer.canAdd(input) else { throw RecorderError.writer("cannot add audio input") }
        writer.add(input)
        guard writer.startWriting() else {
            throw RecorderError.writer(writer.error?.localizedDescription ?? "startWriting failed")
        }
        return Audio(writer: writer, input: input)
    }

    /// Copy of an audio buffer whose first sample is presented at `ptsNs`
    /// (pause offset applied). Every timing entry is shifted by the same delta,
    /// so per-sample durations are preserved. Replacing them with one entry
    /// carrying the whole-buffer duration would be wrong for multi-sample
    /// audio buffers.
    static func retimed(_ sb: CMSampleBuffer, ptsNs: Int64) -> CMSampleBuffer? {
        var count: CMItemCount = 0
        guard CMSampleBufferGetSampleTimingInfoArray(sb, entryCount: 0, arrayToFill: nil,
                                                     entriesNeededOut: &count) == noErr,
              count > 0
        else { return nil }
        var timings = [CMSampleTimingInfo](repeating: CMSampleTimingInfo(), count: count)
        guard CMSampleBufferGetSampleTimingInfoArray(sb, entryCount: count, arrayToFill: &timings,
                                                     entriesNeededOut: &count) == noErr
        else { return nil }
        let delta = CMTimeSubtract(cmTime(ns: ptsNs), CMSampleBufferGetPresentationTimeStamp(sb))
        for i in timings.indices {
            if timings[i].presentationTimeStamp.isValid {
                timings[i].presentationTimeStamp = CMTimeAdd(timings[i].presentationTimeStamp, delta)
            }
            if timings[i].decodeTimeStamp.isValid {
                timings[i].decodeTimeStamp = CMTimeAdd(timings[i].decodeTimeStamp, delta)
            }
        }
        var out: CMSampleBuffer?
        let status = CMSampleBufferCreateCopyWithNewTiming(
            allocator: kCFAllocatorDefault,
            sampleBuffer: sb,
            sampleTimingEntryCount: count,
            sampleTimingArray: &timings,
            sampleBufferOut: &out
        )
        return status == noErr ? out : nil
    }
}

func nanoseconds(_ time: CMTime) -> Int64? {
    guard time.isValid, !time.isIndefinite else { return nil }
    return CMTimeConvertScale(time, timescale: 1_000_000_000, method: .roundHalfAwayFromZero).value
}

func cmTime(ns: Int64) -> CMTime { CMTime(value: ns, timescale: 1_000_000_000) }

enum RecorderError: Error, CustomStringConvertible {
    case permission(String)
    case sourceNotFound(String)
    case writer(String)
    case mic(String)
    case stream(String)

    var code: String {
        switch self {
        case .permission: return "permissionDenied"
        case .sourceNotFound: return "sourceNotFound"
        case .writer: return "writerFailed"
        case .mic: return "micUnavailable"
        case .stream: return "streamFailed"
        }
    }

    var description: String {
        switch self {
        case let .permission(m), let .sourceNotFound(m), let .writer(m), let .mic(m), let .stream(m): return m
        }
    }
}
