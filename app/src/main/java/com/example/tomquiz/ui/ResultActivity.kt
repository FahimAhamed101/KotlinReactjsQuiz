package com.example.tomquiz.ui

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.example.tomquiz.MainActivity
import com.example.tomquiz.R
import com.example.tomquiz.utils.Constants

class ResultActivity : AppCompatActivity() {
    private lateinit var textViewScore: TextView
    private lateinit var textViewName: TextView
    private lateinit var finishButton: Button
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_result)

        textViewScore = findViewById(R.id.textview_score)
        textViewName = findViewById(R.id.textview_name)
        finishButton = findViewById(R.id.finish_button
        )
        val totalQuestions = intent.getIntExtra(Constants.TOTAL_QUESTIONS,0)
        val score = intent.getIntExtra(Constants.SCORE, 0)
        val name = intent.getStringExtra(Constants.USER_NAME)

        textViewScore.text = "Your score is $score out of $totalQuestions"
        textViewName.text = name

        finishButton.setOnClickListener {
            Intent(this, MainActivity::class.java).also {
                startActivity(it)
            }
        }
    }
}