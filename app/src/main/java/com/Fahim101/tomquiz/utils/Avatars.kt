package com.Fahim101.tomquiz.utils

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.widget.ImageView
import com.bumptech.glide.Glide
import com.bumptech.glide.load.DataSource
import com.bumptech.glide.load.engine.GlideException
import com.bumptech.glide.request.RequestListener
import com.bumptech.glide.request.target.Target
import com.Fahim101.tomquiz.R

/**
 * Loading a profile picture that actually stays loaded.
 *
 * Four things go wrong with avatars in this app and they have to be handled together:
 *
 * 1. **The server's mirror route may not exist yet.** Older deployments have no
 *    `/api/v6/avatar/<username>`, so that URL 404s.
 * 2. **The raw TikTok CDN URL is time-signed and expires in ~2 days.** After that it
 *    403s, and a failed load used to render as an empty ring — indistinguishable from
 *    "no picture", which is why this kept looking like a client bug.
 * 3. **The stored URL may be the offline stub's picsum placeholder.** Rendering that is
 *    worse than rendering nothing, because it looks like the wrong person's photo.
 * 4. **Some accounts genuinely have no picture** (the seeded demo accounts). An empty
 *    circle there reads as a broken image.
 *
 * So every load is an ordered list of candidates tried in turn, a placeholder is never a
 * candidate, and the fallback is a lettered avatar derived from the handle — honest, looks
 * deliberate, and never shows a stranger's face.
 */
object Avatars {

    /** The placeholder the offline stub writes; never worth rendering. */
    private fun isPlaceholder(url: String?): Boolean =
        url.isNullOrBlank() || url.contains("picsum.photos")

    /**
     * Ordered candidates for one account: the server mirror first (it cannot expire),
     * then whatever CDN URL we were given.
     */
    fun candidates(username: String?, vararg fallbacks: String?): List<String> {
        val out = LinkedHashSet<String>()
        Constants.avatarUrlFor(username)?.let { out.add(it) }
        for (url in fallbacks) {
            if (isPlaceholder(url)) continue
            out.add(absolute(url!!.trim()))
        }
        return out.toList()
    }

    /**
     * The server returns `avatar_url` and order `image` as paths relative to the API base
     * (`/api/v6/avatar/tiktok/<handle>`). Glide needs an absolute URL, so a relative path
     * failed to load and the avatar silently fell through to the expiring CDN link — or,
     * for task cards and order history, straight to the lettered placeholder. Join it onto
     * the configured base instead.
     */
    private fun absolute(url: String): String =
        if (url.startsWith("http://") || url.startsWith("https://")) url
        else Constants.TTBOOST_API_URL.trimEnd('/') + "/" + url.trimStart('/')

    /** Load [urls] into [view], falling back to a lettered avatar when none resolve. */
    fun load(view: ImageView, urls: List<String>, label: String? = null) {
        loadAt(view, urls, 0, label)
    }

    /**
     * Glide throws `IllegalStateException: You can't start or clear loads in RequestListener
     * or Target callbacks` if the retry is started inline — and that is not a warning: it
     * propagates out of the callback as a `CallbackException` and kills the process. So the
     * retry is always posted to the view's queue, which puts it back on the main thread
     * outside the callback.
     */
    private fun loadAt(view: ImageView, urls: List<String>, index: Int, label: String?) {
        if (index >= urls.size) {
            view.setImageDrawable(initials(view.context, label))
            return
        }

        Glide.with(view)
            .load(urls[index])
            .placeholder(R.drawable.tt_surface_elevated)
            .centerCrop()
            .listener(object : RequestListener<Drawable> {
                override fun onLoadFailed(
                    e: GlideException?,
                    model: Any?,
                    target: Target<Drawable>,
                    isFirstResource: Boolean
                ): Boolean {
                    // Deferred: starting the next load here is what Glide forbids.
                    view.post { loadAt(view, urls, index + 1, label) }
                    return true
                }

                override fun onResourceReady(
                    resource: Drawable,
                    model: Any,
                    target: Target<Drawable>?,
                    dataSource: DataSource,
                    isFirstResource: Boolean
                ): Boolean = false
            })
            .into(view)
    }

    /**
     * A circle with the handle's first letter, coloured from the handle so the same account
     * always gets the same colour.
     */
    fun initials(context: Context, label: String?): Drawable {
        val clean = label?.trim()?.trimStart('@').orEmpty()
        val letter = clean.firstOrNull()?.uppercaseChar()?.toString() ?: "?"

        val size = 128
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)

        val hue = ((clean.lowercase().hashCode() and 0x7fffffff) % 360).toFloat()
        paint.color = Color.HSVToColor(floatArrayOf(hue, 0.45f, 0.52f))
        canvas.drawCircle(size / 2f, size / 2f, size / 2f, paint)

        paint.color = Color.WHITE
        paint.textAlign = Paint.Align.CENTER
        paint.textSize = size * 0.44f
        paint.typeface = Typeface.DEFAULT_BOLD
        val baseline = size / 2f - (paint.descent() + paint.ascent()) / 2f
        canvas.drawText(letter, size / 2f, baseline, paint)

        return BitmapDrawable(context.resources, bitmap)
    }
}
