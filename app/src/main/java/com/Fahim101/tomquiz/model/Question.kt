package com.Fahim101.tomquiz.model

data class Question(
    val id: Int,
    val question: String,
    val image: String,
    val optionOne: String,
    val optionTwo: String,
    val optionThree: String,
    val optionFour: String,
    val correctAnswer: Int
)