package dev.voicetomap.pcm

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.net.Uri
import android.media.MediaRecorder
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Whisper reads 16 kHz mono PCM WAV; MediaRecorder only produces compressed audio. */
class PcmRecorderModule : Module() {
  private var recorder: AudioRecord? = null
  private var worker: Thread? = null
  private var output: File? = null
  @Volatile private var recording = false
  @Volatile private var failure: Exception? = null

  override fun definition() = ModuleDefinition {
    Name("PcmRecorder")
    AsyncFunction("start") { startRecording() }
    AsyncFunction("stop") { stopRecording() }
    OnDestroy { runCatching { stopRecording() } }
  }

  @SuppressLint("MissingPermission") // The app requests RECORD_AUDIO before calling start.
  @Synchronized private fun startRecording() {
    check(recorder == null) { "The microphone is already recording." }
    val context = appContext.reactContext ?: error("The app is not ready.")
    val min = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    check(min > 0) { "This phone cannot record 16 kHz PCM." }
    val audio = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, 16000,
      AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(min * 2, 4096))
    if (audio.state != AudioRecord.STATE_INITIALIZED) {
      audio.release()
      error("Could not initialize the microphone.")
    }
    val file = File(context.cacheDir, "position-report.wav")
    val stream = RandomAccessFile(file, "rw")
    try {
      stream.setLength(0)
      stream.write(ByteArray(44))
      audio.startRecording()
      check(audio.recordingState == AudioRecord.RECORDSTATE_RECORDING) { "Could not start the microphone." }
    } catch (e: Exception) {
      stream.close()
      audio.release()
      throw e
    }
    output = file
    failure = null
    recording = true
    recorder = audio
    worker = Thread({
      try {
        stream.use {
          val buffer = ByteArray(2048)
          var size = 0
          while (recording && size < 16000 * 2 * 16) {
            val count = audio.read(buffer, 0, buffer.size)
            if (count > 0) {
              it.write(buffer, 0, count)
              size += count
            } else if (recording) {
              error("Microphone read failed ($count).")
            }
          }
          val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
          header.put("RIFF".toByteArray()).putInt(size + 36).put("WAVEfmt ".toByteArray())
          header.putInt(16).putShort(1).putShort(1).putInt(16000).putInt(32000)
          header.putShort(2).putShort(16).put("data".toByteArray()).putInt(size)
          it.seek(0)
          it.write(header.array())
        }
      } catch (e: Exception) {
        failure = e
      } finally {
        recording = false
      }
    }, "PositionPcmRecorder").also { it.start() }
  }

  @Synchronized private fun stopRecording(): String {
    val audio = recorder ?: return ""
    recording = false
    try {
      if (audio.recordingState == AudioRecord.RECORDSTATE_RECORDING) audio.stop()
      worker?.join()
    } finally {
      audio.release()
      recorder = null
      worker = null
    }
    failure?.let { throw it }
    return output?.takeIf { it.length() > 44 }?.let { Uri.fromFile(it).toString() } ?: ""
  }
}
