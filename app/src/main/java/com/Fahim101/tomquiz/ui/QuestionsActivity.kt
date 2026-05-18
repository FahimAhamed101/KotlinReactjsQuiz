package com.Fahim101.tomquiz.ui

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.util.Log
import android.view.View
import android.widget.Button
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.Fahim101.tomquiz.R
import com.bumptech.glide.Glide

import com.Fahim101.tomquiz.model.Question
import com.Fahim101.tomquiz.utils.Constants

class QuestionsActivity : AppCompatActivity(), View.OnClickListener {
    private lateinit var progressBar: ProgressBar
    private lateinit var textViewProgress: TextView
    private lateinit var textViewQuestion: TextView
    private lateinit var flagImage: ImageView

    private lateinit var textViewOptionOne: TextView
    private lateinit var textViewOptionTwo: TextView
    private lateinit var textViewOptionThree: TextView
    private lateinit var textViewOptionFour: TextView

    private lateinit var checkButton: Button

    private var currentPosition = 1
    private lateinit var questionsList: MutableList<Question>
    private var selectedOptionPosition = 0
    private var answered = false
    private lateinit var name: String
    private var score = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_questions)

        initializeViews()
        setupClickListeners()

        questionsList = Constants.getQuestions()
        Log.d("QuestionSize", "${questionsList.size}")

        if (intent.hasExtra(Constants.USER_NAME)) {
            name = intent.getStringExtra(Constants.USER_NAME)!!
        }

        showQuestion()
    }

    private fun initializeViews() {
        progressBar = findViewById(R.id.progressBar)
        textViewProgress = findViewById(R.id.text_view_progress)
        textViewQuestion = findViewById(R.id.question_text_view)
        flagImage = findViewById(R.id.image_flag)
        checkButton = findViewById(R.id.button_check)

        textViewOptionOne = findViewById(R.id.text_view_option_one)
        textViewOptionTwo = findViewById(R.id.text_view_option_two)
        textViewOptionThree = findViewById(R.id.text_view_option_three)
        textViewOptionFour = findViewById(R.id.text_view_option_four)
    }

    private fun setupClickListeners() {
        textViewOptionOne.setOnClickListener(this)
        textViewOptionTwo.setOnClickListener(this)
        textViewOptionThree.setOnClickListener(this)
        textViewOptionFour.setOnClickListener(this)
        checkButton.setOnClickListener(this)
    }

    private fun showQuestion() {
        if (currentPosition <= questionsList.size) {
            val currentQuestion = questionsList[currentPosition - 1]

            defaultOptionsView()

            // Update progress
            progressBar.progress = currentPosition
            textViewProgress.text = "$currentPosition/${questionsList.size}"

            // Set question text
            textViewQuestion.text = currentQuestion.question

            // Load image using Glide
            Glide.with(this)
                .load(currentQuestion.image)
                .placeholder(R.drawable.react) // Add a placeholder image
                .error(R.drawable.react) // Add an error image
                .into(flagImage)

            // Set options
            textViewOptionOne.text = currentQuestion.optionOne
            textViewOptionTwo.text = currentQuestion.optionTwo
            textViewOptionThree.text = currentQuestion.optionThree
            textViewOptionFour.text = currentQuestion.optionFour

            answered = false
            selectedOptionPosition = 0
            checkButton.text = "CHECK"
        } else {
            // All questions completed - navigate to result activity
            // You'll need to implement this part
            Log.d("Questions", "All questions completed!")
        }
    }

    private fun defaultOptionsView() {
        val options = listOf(textViewOptionOne, textViewOptionTwo, textViewOptionThree, textViewOptionFour)

        for (option in options) {
            option.setTextColor(Color.parseColor("#7A8089"))
            option.typeface = Typeface.DEFAULT
            option.background = ContextCompat.getDrawable(
                this,
                R.drawable.default_option_border_bg
            )
        }
    }

    private fun selectedOption(textView: TextView, selectedOption: Int) {
        defaultOptionsView()
        selectedOptionPosition = selectedOption

        textView.setTextColor(Color.parseColor("#363A43"))
        textView.setTypeface(textView.typeface, Typeface.BOLD)
        textView.background = ContextCompat.getDrawable(
            this,
            R.drawable.selected_option_border_bg
        )
    }

    private fun checkAnswer() {
        if (selectedOptionPosition == 0) {
            // No option selected
            return
        }

        answered = true
        val currentQuestion = questionsList[currentPosition - 1]

        if (selectedOptionPosition == currentQuestion.correctAnswer) {
            score++
        }

        // Show correct answer
        showCorrectAnswer()
        checkButton.text = "NEXT"
    }
    private fun showCorrectAnswer() {
        val currentQuestion = questionsList[currentPosition - 1]
        val correctOptionView = when (currentQuestion.correctAnswer) {
            1 -> textViewOptionOne
            2 -> textViewOptionTwo
            3 -> textViewOptionThree
            4 -> textViewOptionFour
            else -> null
        }

        correctOptionView?.background = ContextCompat.getDrawable(
            this,
            R.drawable.correct_option_border_bg
        )
    }


    private fun showNextQuestion() {
        currentPosition++
        if (currentPosition <= questionsList.size) {
            showQuestion()
        } else {
            checkButton.text = "FINISH"
            //start activity here
            Intent(this, ResultActivity::class.java).also {
                it.putExtra(Constants.USER_NAME,name)
                it.putExtra(Constants.SCORE, score)
                it.putExtra(Constants.TOTAL_QUESTIONS, questionsList.size)

                startActivity(it)
            }
            // Quiz completed
            // Navigate to result activity
            Log.d("Quiz", "Quiz completed! Score: $score/${questionsList.size}")
            // You can add navigation to result activity here
        }
    }

    override fun onClick(view: View?) {
        when (view?.id) {
            R.id.text_view_option_one -> {
                if (!answered) {
                    selectedOption(textViewOptionOne, 1)
                }
            }
            R.id.text_view_option_two -> {
                if (!answered) {
                    selectedOption(textViewOptionTwo, 2)
                }
            }
            R.id.text_view_option_three -> {
                if (!answered) {
                    selectedOption(textViewOptionThree, 3)
                }
            }
            R.id.text_view_option_four -> {
                if (!answered) {
                    selectedOption(textViewOptionFour, 4)
                }
            }
            R.id.button_check -> {
                if (!answered) {
                    if (selectedOptionPosition != 0) {
                        checkAnswer()
                    }
                } else {
                    showNextQuestion()
                }
            }
        }
    }
}