import Foundation
import Vision
import ImageIO

struct OCRLine: Codable {
  let text: String
  let confidence: Double
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

struct OCRResult: Codable {
  let text: String
  let lines: [OCRLine]
  let width: Int
  let height: Int
}

func fail(_ message: String) -> Never {
  FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
  exit(2)
}

guard CommandLine.arguments.count >= 2 else {
  fail("usage: ocr <image>")
}

let path = CommandLine.arguments[1]
let url = URL(fileURLWithPath: path)
guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
  fail("cannot read image: \(path)")
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["zh-Hans", "en-US"]
request.usesLanguageCorrection = true

let handler = VNImageRequestHandler(cgImage: image, options: [:])
do {
  try handler.perform([request])
} catch {
  fail("vision failed: \(error.localizedDescription)")
}

let observations = (request.results ?? []).sorted { a, b in
  let ay = a.boundingBox.midY
  let by = b.boundingBox.midY
  if abs(ay - by) > 0.02 { return ay > by }
  return a.boundingBox.minX < b.boundingBox.minX
}

var lines: [OCRLine] = []
for observation in observations {
  guard let candidate = observation.topCandidates(1).first else { continue }
  let box = observation.boundingBox
  lines.append(OCRLine(
    text: candidate.string,
    confidence: Double(candidate.confidence),
    x: Double(box.minX),
    y: Double(box.minY),
    width: Double(box.width),
    height: Double(box.height)
  ))
  if lines.count >= 240 { break }
}

let text = lines.map { $0.text }.joined(separator: "\n")
let result = OCRResult(text: text, lines: lines, width: image.width, height: image.height)
let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys]
guard let data = try? encoder.encode(result) else { fail("encode failed") }
FileHandle.standardOutput.write(data)
